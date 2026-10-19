import type { JSX, ReactNode } from "react";
import type { DesktopApi } from "../electron/desktop-contract.ts";
import { ClerkProvider, useClerk, useUser } from "@clerk/electron/react";
import { zhCN } from "@clerk/localizations";
import { createContext, useContext } from "react";

declare global {
  interface Window {
    prismDesktop?: DesktopApi;
  }
}

interface Account {
  status: "unavailable" | "loading" | "signed-out" | "signed-in";
  name?: string;
  email?: string;
  imageUrl?: string;
  signIn: () => void;
  profile: () => void;
  signOut: () => Promise<void>;
}

const AccountContext = createContext<Account | null>(null);
const localization = {
  ...zhCN,
  signIn: {
    ...zhCN.signIn,
    start: {
      ...zhCN.signIn?.start,
      title: "登录 Prism",
      titleCombined: "继续使用 Prism",
    },
  },
  signUp: {
    ...zhCN.signUp,
    start: {
      ...zhCN.signUp?.start,
      subtitle: "继续使用 Prism",
      subtitleCombined: "继续使用 Prism",
    },
  },
};

export function AccountProvider({ children }: { children: ReactNode }): JSX.Element {
  const key = window.prismDesktop?.clerkPublishableKey;
  if (!key) return <>{children}</>;
  return (
    <ClerkProvider
      publishableKey={key}
      localization={localization}
      appearance={{
        variables: {
          colorPrimary: "#1f2328",
          colorBackground: "#ffffff",
          colorForeground: "#1f2328",
          fontFamily:
            '"Inter Variable", Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
          borderRadius: "6px",
        },
      }}
    >
      <ConnectedAccount>{children}</ConnectedAccount>
    </ClerkProvider>
  );
}

function ConnectedAccount({ children }: { children: ReactNode }): JSX.Element {
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();
  const account: Account = {
    status: !isLoaded ? "loading" : isSignedIn ? "signed-in" : "signed-out",
    name: user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress,
    email: user?.primaryEmailAddress?.emailAddress,
    imageUrl: user?.imageUrl,
    signIn: () => clerk.openSignIn(),
    profile: () => clerk.openUserProfile(),
    signOut: async () => {
      await clerk.signOut();
    },
  };
  return <AccountContext value={account}>{children}</AccountContext>;
}

export function useAccount(): Account | null {
  return useContext(AccountContext);
}
