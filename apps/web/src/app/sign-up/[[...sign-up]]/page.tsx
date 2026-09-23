import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
      <SignUp path="/sign-up" />
    </main>
  );
}
