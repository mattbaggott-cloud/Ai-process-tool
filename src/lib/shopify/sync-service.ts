/**
 * Shopify Sync Service — imports customers, orders, and products
 * from Shopify via the GraphQL Admin API.
 *
 * Uses cursor-based pagination and upserts into ecom_* tables.
 * After sync, creates graph nodes for all synced records.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShopifyConfig } from "@/lib/types/database";
import { syncRecordToGraph } from "@/lib/agentic/graph-sync";

/* ── Constants ──────────────────────────────────────────── */

const BATCH_SIZE = 50;
const API_VERSION = "2026-01";
const EXTERNAL_SOURCE = "shopify";

/* ── Types ──────────────────────────────────────────────── */

interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

/* ── Logging ───────────────────────────────────────────── */

/**
 * Log a sync event to data_sync_log (same pattern as HubSpot).
 */
export async function logSync(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string,
  eventType: "info" | "warning" | "error" | "success",
  message: string,
  details: Record<string, unknown> = {}
) {
  await supabase.from("data_sync_log").insert({
    user_id: userId,
    org_id: orgId,
    connector_id: connectorId,
    event_type: eventType,
    message,
    details,
  });
}

/* ── Helpers ────────────────────────────────────────────── */

/**
 * Extract numeric ID from Shopify GID format.
 * e.g. "gid://shopify/Customer/123" -> "123"
 */
function extractId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1];
}

/**
 * Execute a Shopify GraphQL query with automatic error handling.
 */
async function shopifyGraphQL(
  config: ShopifyConfig,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const url = `https://${config.shop}/admin/api/${API_VERSION}/graphql.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.access_token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify GraphQL error (${res.status}): ${body}`);
  }

  const json = await res.json();

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as Record<string, unknown>;
}

/**
 * Parse a money amount string to number.
 */
function parseMoney(amount: string | null | undefined): number | null {
  if (!amount) return null;
  const n = parseFloat(amount);
  return isNaN(n) ? null : n;
}

/* ── GraphQL Queries ────────────────────────────────────── */

const CUSTOMERS_QUERY = `
  query CustomersQuery($first: Int!, $after: String) {
    customers(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          email
          firstName
          lastName
          phone
          numberOfOrders
          amountSpent {
            amount
            currencyCode
          }
          tags
          emailMarketingConsent {
            marketingState
          }
          defaultAddress {
            address1
            city
            province
            country
            zip
          }
          createdAt
          updatedAt
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

const ORDERS_QUERY = `
  query OrdersQuery($first: Int!, $after: String) {
    orders(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          name
          email
          customer {
            id
          }
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          subtotalPriceSet {
            shopMoney {
              amount
            }
          }
          totalTaxSet {
            shopMoney {
              amount
            }
          }
          currentTotalDiscountsSet {
            shopMoney {
              amount
            }
          }
          totalShippingPriceSet {
            shopMoney {
              amount
            }
          }
          lineItems(first: 50) {
            edges {
              node {
                product {
                  id
                }
                variant {
                  id
                }
                title
                variantTitle
                quantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
                sku
              }
            }
          }
          shippingAddress {
            address1
            address2
            city
            province
            country
            zip
            name
            phone
          }
          tags
          note
          sourceName
          processedAt
          cancelledAt
          closedAt
          createdAt
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

const PRODUCTS_QUERY = `
  query ProductsQuery($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          title
          handle
          bodyHtml
          vendor
          productType
          status
          tags
          publishedAt
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                sku
                inventoryQuantity
                inventoryItem {
                  measurement {
                    weight {
                      value
                      unit
                    }
                  }
                }
              }
            }
          }
          images(first: 10) {
            edges {
              node {
                id
                url
                altText
              }
            }
          }
          createdAt
          updatedAt
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

/* ── Import: Customers ──────────────────────────────────── */

export async function importCustomers(
  config: ShopifyConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };
  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 0;

  await logSync(supabase, userId, orgId, connectorId, "info", "Starting Shopify customers import...");

  do {
    const variables: Record<string, unknown> = { first: BATCH_SIZE };
    if (cursor) variables.after = cursor;

    const data = await shopifyGraphQL(config, CUSTOMERS_QUERY, variables);
    const connection = data.customers as {
      edges: Array<{ cursor: string; node: Record<string, unknown> }>;
      pageInfo: { hasNextPage: boolean };
    };

    const edges = connection.edges || [];
    hasNextPage = connection.pageInfo.hasNextPage;

    for (const edge of edges) {
      cursor = edge.cursor;
      const node = edge.node;

      try {
        const gid = node.id as string;
        const externalId = extractId(gid);

        const amountSpent = node.amountSpent as { amount: string; currencyCode: string } | null;
        const emailConsent = node.emailMarketingConsent as { marketingState: string } | null;
        const defaultAddr = node.defaultAddress as Record<string, unknown> | null;
        const numberOfOrders = node.numberOfOrders as string | number | null;

        const customerData = {
          org_id: orgId,
          external_id: externalId,
          external_source: EXTERNAL_SOURCE,
          email: (node.email as string) || null,
          first_name: (node.firstName as string) || null,
          last_name: (node.lastName as string) || null,
          phone: (node.phone as string) || null,
          orders_count: typeof numberOfOrders === "number" ? numberOfOrders : parseInt(String(numberOfOrders || "0"), 10) || 0,
          total_spent: parseMoney(amountSpent?.amount) ?? 0,
          avg_order_value: 0, // will be recalculated after orders import
          tags: (node.tags as string[]) || [],
          accepts_marketing: emailConsent?.marketingState === "SUBSCRIBED",
          default_address: defaultAddr || null,
          metadata: {
            shopify_gid: gid,
            currency_code: amountSpent?.currencyCode || null,
          },
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Dedup by external_id + external_source
        const { data: existing } = await supabase
          .from("ecom_customers")
          .select("id, updated_at")
          .eq("org_id", orgId)
          .eq("external_id", externalId)
          .eq("external_source", EXTERNAL_SOURCE)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("ecom_customers")
            .update(customerData)
            .eq("id", existing.id);
          result.updated++;
        } else {
          await supabase.from("ecom_customers").insert(customerData);
          result.created++;
        }
      } catch (err) {
        console.error("Error importing Shopify customer:", err);
        result.errors++;
      }
    }

    page++;
    if (page % 5 === 0) {
      await logSync(supabase, userId, orgId, connectorId, "info",
        `Importing customers: ${result.created + result.updated + result.skipped} processed...`);
    }
  } while (hasNextPage);

  await logSync(supabase, userId, orgId, connectorId, "success",
    `Customers import done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`,
    { result });

  return result;
}

/* ── Import: Orders ─────────────────────────────────────── */

export async function importOrders(
  config: ShopifyConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };
  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 0;

  await logSync(supabase, userId, orgId, connectorId, "info", "Starting Shopify orders import...");

  do {
    const variables: Record<string, unknown> = { first: BATCH_SIZE };
    if (cursor) variables.after = cursor;

    const data = await shopifyGraphQL(config, ORDERS_QUERY, variables);
    const connection = data.orders as {
      edges: Array<{ cursor: string; node: Record<string, unknown> }>;
      pageInfo: { hasNextPage: boolean };
    };

    const edges = connection.edges || [];
    hasNextPage = connection.pageInfo.hasNextPage;

    for (const edge of edges) {
      cursor = edge.cursor;
      const node = edge.node;

      try {
        const gid = node.id as string;
        const externalId = extractId(gid);

        // Extract customer external ID
        const customerNode = node.customer as { id: string } | null;
        const customerExternalId = customerNode ? extractId(customerNode.id) : null;

        // Look up local customer ID
        let customerId: string | null = null;
        if (customerExternalId) {
          const { data: localCustomer } = await supabase
            .from("ecom_customers")
            .select("id")
            .eq("org_id", orgId)
            .eq("external_id", customerExternalId)
            .eq("external_source", EXTERNAL_SOURCE)
            .maybeSingle();
          if (localCustomer) customerId = localCustomer.id;
        }

        // Extract money fields
        const totalPriceSet = node.totalPriceSet as { shopMoney: { amount: string; currencyCode: string } } | null;
        const subtotalPriceSet = node.subtotalPriceSet as { shopMoney: { amount: string } } | null;
        const totalTaxSet = node.totalTaxSet as { shopMoney: { amount: string } } | null;
        const totalDiscountsSet = node.currentTotalDiscountsSet as { shopMoney: { amount: string } } | null;
        const totalShippingSet = node.totalShippingPriceSet as { shopMoney: { amount: string } } | null;

        // Extract line items
        const lineItemsConnection = node.lineItems as {
          edges: Array<{ node: Record<string, unknown> }>;
        } | null;
        const lineItems = (lineItemsConnection?.edges || []).map((li) => {
          const liNode = li.node;
          const productRef = liNode.product as { id: string } | null;
          const variantRef = liNode.variant as { id: string } | null;
          const priceSet = liNode.originalUnitPriceSet as { shopMoney: { amount: string } } | null;
          return {
            product_id: productRef ? extractId(productRef.id) : null,
            variant_id: variantRef ? extractId(variantRef.id) : null,
            title: (liNode.title as string) || "",
            variant_title: (liNode.variantTitle as string) || null,
            quantity: (liNode.quantity as number) || 0,
            price: parseMoney(priceSet?.shopMoney?.amount) ?? 0,
            sku: (liNode.sku as string) || null,
          };
        });

        // Extract shipping address
        const shippingAddr = node.shippingAddress as Record<string, unknown> | null;

        const orderData = {
          org_id: orgId,
          external_id: externalId,
          external_source: EXTERNAL_SOURCE,
          customer_id: customerId,
          customer_external_id: customerExternalId,
          order_number: (node.name as string) || null,
          email: (node.email as string) || null,
          financial_status: (node.displayFinancialStatus as string)?.toLowerCase() || null,
          fulfillment_status: (node.displayFulfillmentStatus as string)?.toLowerCase() || null,
          total_price: parseMoney(totalPriceSet?.shopMoney?.amount),
          subtotal_price: parseMoney(subtotalPriceSet?.shopMoney?.amount),
          total_tax: parseMoney(totalTaxSet?.shopMoney?.amount),
          total_discounts: parseMoney(totalDiscountsSet?.shopMoney?.amount),
          total_shipping: parseMoney(totalShippingSet?.shopMoney?.amount),
          currency: totalPriceSet?.shopMoney?.currencyCode || "USD",
          line_items: lineItems,
          shipping_address: shippingAddr || null,
          tags: (node.tags as string[]) || [],
          note: (node.note as string) || null,
          source_name: (node.sourceName as string) || null,
          cancelled_at: (node.cancelledAt as string) || null,
          closed_at: (node.closedAt as string) || null,
          processed_at: (node.processedAt as string) || null,
          metadata: {
            shopify_gid: gid,
          },
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Dedup by external_id + external_source
        const { data: existing } = await supabase
          .from("ecom_orders")
          .select("id, updated_at")
          .eq("org_id", orgId)
          .eq("external_id", externalId)
          .eq("external_source", EXTERNAL_SOURCE)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("ecom_orders")
            .update(orderData)
            .eq("id", existing.id);
          result.updated++;
        } else {
          await supabase.from("ecom_orders").insert(orderData);
          result.created++;
        }
      } catch (err) {
        console.error("Error importing Shopify order:", err);
        result.errors++;
      }
    }

    page++;
    if (page % 5 === 0) {
      await logSync(supabase, userId, orgId, connectorId, "info",
        `Importing orders: ${result.created + result.updated + result.skipped} processed...`);
    }
  } while (hasNextPage);

  // Recalculate customer aggregates from all orders
  await recalculateCustomerAggregates(supabase, userId, orgId, connectorId);

  await logSync(supabase, userId, orgId, connectorId, "success",
    `Orders import done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`,
    { result });

  return result;
}

/**
 * Recalculate customer aggregates (total_spent, orders_count, avg_order_value,
 * first_order_at, last_order_at) from all orders for the org.
 */
async function recalculateCustomerAggregates(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<void> {
  await logSync(supabase, userId, orgId, connectorId, "info", "Recalculating customer aggregates from orders...");

  try {
    // Get all customers for the org
    const { data: customers, error: custError } = await supabase
      .from("ecom_customers")
      .select("id, external_id")
      .eq("org_id", orgId)
      .eq("external_source", EXTERNAL_SOURCE);

    if (custError || !customers) {
      console.error("Error fetching customers for aggregate recalculation:", custError);
      return;
    }

    for (const customer of customers) {
      try {
        // Get all orders for this customer
        const { data: orders } = await supabase
          .from("ecom_orders")
          .select("total_price, processed_at, created_at")
          .eq("org_id", orgId)
          .eq("customer_external_id", customer.external_id)
          .eq("external_source", EXTERNAL_SOURCE);

        if (!orders || orders.length === 0) continue;

        const ordersCount = orders.length;
        const totalSpent = orders.reduce((sum, o) => sum + (o.total_price || 0), 0);
        const avgOrderValue = ordersCount > 0 ? totalSpent / ordersCount : 0;

        // Determine first and last order dates
        const orderDates = orders
          .map((o) => o.processed_at || o.created_at)
          .filter(Boolean)
          .sort();

        const firstOrderAt = orderDates[0] || null;
        const lastOrderAt = orderDates[orderDates.length - 1] || null;

        await supabase
          .from("ecom_customers")
          .update({
            orders_count: ordersCount,
            total_spent: Math.round(totalSpent * 100) / 100,
            avg_order_value: Math.round(avgOrderValue * 100) / 100,
            first_order_at: firstOrderAt,
            last_order_at: lastOrderAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", customer.id);
      } catch (err) {
        console.error(`Error recalculating aggregates for customer ${customer.id}:`, err);
      }
    }

    await logSync(supabase, userId, orgId, connectorId, "info", "Customer aggregates recalculated successfully");
  } catch (err) {
    console.error("Error in aggregate recalculation:", err);
    await logSync(supabase, userId, orgId, connectorId, "warning", "Failed to recalculate customer aggregates", {
      error: String(err),
    });
  }
}

/* ── Import: Products ───────────────────────────────────── */

export async function importProducts(
  config: ShopifyConfig,
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  connectorId: string
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: 0 };
  let cursor: string | null = null;
  let hasNextPage = true;
  let page = 0;

  await logSync(supabase, userId, orgId, connectorId, "info", "Starting Shopify products import...");

  do {
    const variables: Record<string, unknown> = { first: BATCH_SIZE };
    if (cursor) variables.after = cursor;

    const data = await shopifyGraphQL(config, PRODUCTS_QUERY, variables);
    const connection = data.products as {
      edges: Array<{ cursor: string; node: Record<string, unknown> }>;
      pageInfo: { hasNextPage: boolean };
    };

    const edges = connection.edges || [];
    hasNextPage = connection.pageInfo.hasNextPage;

    for (const edge of edges) {
      cursor = edge.cursor;
      const node = edge.node;

      try {
        const gid = node.id as string;
        const externalId = extractId(gid);

        // Extract variants
        const variantsConnection = node.variants as {
          edges: Array<{ node: Record<string, unknown> }>;
        } | null;
        const variants = (variantsConnection?.edges || []).map((v) => {
          const vNode = v.node;
          const inventoryItem = vNode.inventoryItem as { measurement?: { weight?: { value: number; unit: string } } } | null;
          const weightData = inventoryItem?.measurement?.weight;
          return {
            id: extractId(vNode.id as string),
            title: (vNode.title as string) || "",
            price: parseFloat((vNode.price as string) || "0") || 0,
            sku: (vNode.sku as string) || null,
            inventory_quantity: (vNode.inventoryQuantity as number) ?? null,
            weight: weightData?.value ?? null,
            weight_unit: weightData?.unit || null,
          };
        });

        // Extract images
        const imagesConnection = node.images as {
          edges: Array<{ node: Record<string, unknown> }>;
        } | null;
        const images = (imagesConnection?.edges || []).map((img) => {
          const imgNode = img.node;
          return {
            id: extractId(imgNode.id as string),
            url: (imgNode.url as string) || "",
            alt_text: (imgNode.altText as string) || null,
          };
        });

        const productData = {
          org_id: orgId,
          external_id: externalId,
          external_source: EXTERNAL_SOURCE,
          title: (node.title as string) || "Untitled Product",
          handle: (node.handle as string) || null,
          body_html: (node.bodyHtml as string) || null,
          vendor: (node.vendor as string) || null,
          product_type: (node.productType as string) || null,
          status: ((node.status as string) || "active").toLowerCase(),
          tags: (node.tags as string[]) || [],
          variants,
          images,
          metadata: {
            shopify_gid: gid,
          },
          published_at: (node.publishedAt as string) || null,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Dedup by external_id + external_source
        const { data: existing } = await supabase
          .from("ecom_products")
          .select("id, updated_at")
          .eq("org_id", orgId)
          .eq("external_id", externalId)
          .eq("external_source", EXTERNAL_SOURCE)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("ecom_products")
            .update(productData)
            .eq("id", existing.id);
          result.updated++;
        } else {
          await supabase.from("ecom_products").insert(productData);
          result.created++;
        }
      } catch (err) {
        console.error("Error importing Shopify product:", err);
        result.errors++;
      }
    }

    page++;
    if (page % 5 === 0) {
      await logSync(supabase, userId, orgId, connectorId, "info",
        `Importing products: ${result.created + result.updated + result.skipped} processed...`);
    }
  } while (hasNextPage);

  await logSync(supabase, userId, orgId, connectorId, "success",
    `Products import done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`,
    { result });

  return result;
}

/* ── Graph Node Sync ────────────────────────────────────── */

/**
 * After a Shopify sync, create graph nodes for all synced records.
 * Iterates through ecom_customers, ecom_orders, and ecom_products
 * and calls syncRecordToGraph for each.
 */
export async function syncGraphNodes(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ customers: number; orders: number; products: number }> {
  const counts = { customers: 0, orders: 0, products: 0 };

  // Sync customer nodes
  const { data: customers } = await supabase
    .from("ecom_customers")
    .select("*")
    .eq("org_id", orgId)
    .eq("external_source", EXTERNAL_SOURCE);

  if (customers) {
    for (const customer of customers) {
      const label =
        [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
        customer.email ||
        "Unknown Customer";
      const sublabel = customer.email || null;

      await syncRecordToGraph(
        supabase,
        orgId,
        "ecom_customers",
        customer.id,
        { ...customer, label, sublabel }
      );
      counts.customers++;
    }
  }

  // Sync order nodes
  const { data: orders } = await supabase
    .from("ecom_orders")
    .select("*")
    .eq("org_id", orgId)
    .eq("external_source", EXTERNAL_SOURCE);

  if (orders) {
    for (const order of orders) {
      const label = order.order_number || `Order #${order.external_id}`;
      const sublabel = [
        order.financial_status,
        order.total_price ? `$${order.total_price}` : null,
      ]
        .filter(Boolean)
        .join(" - ");

      await syncRecordToGraph(
        supabase,
        orgId,
        "ecom_orders",
        order.id,
        { ...order, label, sublabel }
      );
      counts.orders++;
    }
  }

  // Sync product nodes
  const { data: products } = await supabase
    .from("ecom_products")
    .select("*")
    .eq("org_id", orgId)
    .eq("external_source", EXTERNAL_SOURCE);

  if (products) {
    for (const product of products) {
      const label = product.title || "Untitled Product";
      const sublabel = [product.vendor, product.product_type]
        .filter(Boolean)
        .join(" - ") || null;

      await syncRecordToGraph(
        supabase,
        orgId,
        "ecom_products",
        product.id,
        { ...product, label, sublabel }
      );
      counts.products++;
    }
  }

  return counts;
}
