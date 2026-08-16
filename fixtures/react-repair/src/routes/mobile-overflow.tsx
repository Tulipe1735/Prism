import "./mobile-overflow.css";

/** 场景 5：桌面布局正常，但已知缺陷态的结账操作区在移动视口横向溢出。 */
export function MobileOverflowPage() {
  return (
    <main className="page">
      <h1>Checkout</h1>
      <section className="checkout-card" aria-label="Order summary">
        <h2>Order summary</h2>
        <p>Developer plan · $29 / month</p>
        <div className="checkout-actions" role="region" aria-label="Checkout actions">
          <button type="button">Back</button>
          <button type="button">Place order</button>
        </div>
      </section>
    </main>
  );
}
