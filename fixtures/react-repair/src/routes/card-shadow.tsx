import "./card-shadow.css";

/** 场景 2：profile card 缺少阴影，但布局与内容正确。 */
export function CardShadowPage() {
  return (
    <main className="page">
      <h1>Team directory</h1>
      <section className="profile-card" aria-label="Profile card">
        <p className="profile-card__eyebrow">Design systems</p>
        <h2>Ada Lovelace</h2>
        <p>Principal engineer · London</p>
      </section>
    </main>
  );
}
