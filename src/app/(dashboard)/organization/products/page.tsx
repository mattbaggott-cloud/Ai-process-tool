"use client";

import ProductsTab from "@/components/crm/ProductsTab";

export default function ProductsPage() {
  return (
    <>
      {/* ─── Header ─── */}
      <div className="canvas-header">
        <h1 className="canvas-title">Products</h1>
        <p className="canvas-subtitle">
          Manage your product and SKU catalog
        </p>
      </div>

      {/* ─── Content ─── */}
      <div className="canvas-content">
        <ProductsTab />
      </div>
    </>
  );
}
