import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";

import { ProfileDialogPage } from "./profile-dialog";

it("keeps the trigger and Dialog keyboard-accessible", () => {
  const markup = renderToString(<ProfileDialogPage />);

  expect(markup).toMatch(/<button[^>]*>Edit profile<\/button>/);
  expect(markup).toContain('<dialog class="profile-dialog" aria-label="Edit profile"');
  expect(markup).toContain("autofocus");
  expect(markup).toContain('method="dialog"');
});
