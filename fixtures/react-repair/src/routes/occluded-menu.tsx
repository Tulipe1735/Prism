import { useState } from "react";

import "./occluded-menu.css";

/** 场景 6：从菜单已打开的复现点开始；已知缺陷态的 header 会截获菜单项点击。 */
export function OccludedMenuPage() {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState(false);

  return (
    <main className="account-page">
      <header className="account-header">
        <strong>Prism account</strong>
        <button
          className="account-menu-trigger"
          type="button"
          aria-expanded={open}
          aria-controls="account-menu"
          onClick={() => setOpen((value) => !value)}
        >
          Account menu
        </button>
      </header>

      {open ? (
        <div
          id="account-menu"
          className="account-menu"
          role="menu"
          aria-label="Account menu"
        >
          <button
            type="button"
            role="menuitem"
            data-activated={selected}
            onClick={() => setSelected(true)}
          >
            Profile
          </button>
          <button type="button" role="menuitem">
            Sign out
          </button>
        </div>
      ) : null}

      <section className="account-content" aria-label="Account overview">
        <h1>Welcome back, Ada</h1>
        <p>Use the account menu to manage your profile.</p>
        <output aria-live="polite">
          {selected ? "Profile selected" : "No selection"}
        </output>
      </section>
    </main>
  );
}
