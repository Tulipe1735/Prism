import { useRef } from "react";

import "./profile-dialog.css";

/** 场景 3：按钮存在且可操作，但已知缺陷态不会打开 Dialog。 */
export function ProfileDialogPage() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <main className="page">
      <h1>Account</h1>
      <section className="profile-summary" aria-label="Profile summary">
        <h2>Ada Lovelace</h2>
        <p>ada@example.test</p>
        <button className="edit-profile-button" type="button" onClick={() => undefined}>
          Edit profile
        </button>
      </section>

      <dialog ref={dialogRef} className="profile-dialog" aria-label="Edit profile">
        <form method="dialog">
          <label>
            Display name
            <input name="displayName" defaultValue="Ada Lovelace" autoFocus />
          </label>
          <button type="submit">Done</button>
        </form>
      </dialog>
    </main>
  );
}
