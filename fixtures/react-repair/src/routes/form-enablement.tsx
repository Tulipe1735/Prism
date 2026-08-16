import { useState } from "react";

import "./form-enablement.css";

/** 场景 4：原生邮箱校验已正确更新，但已知缺陷态仍会禁用 Submit。 */
export function FormEnablementPage() {
  const [email, setEmail] = useState("");
  const [valid, setValid] = useState(false);

  return (
    <main className="page">
      <h1>Join the waitlist</h1>
      <form className="signup-form" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          name="email"
          type="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
            setValid(event.currentTarget.validity.valid);
          }}
        />
        <button type="submit" disabled={!valid || email.includes("@")}>
          Submit
        </button>
      </form>
    </main>
  );
}
