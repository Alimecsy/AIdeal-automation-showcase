import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
      <SignIn path="/sign-in" />
    </main>
  );
}
