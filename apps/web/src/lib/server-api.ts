import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { backendApiFetch } from "./backend-api";

type ApiFetchOptions = Omit<RequestInit, "headers"> & {
  headers?: RequestInit["headers"];
};

async function getSessionToken() {
  const authState = await auth();

  if (!authState.isAuthenticated) {
    redirect("/sign-in");
  }

  const token = await authState.getToken();

  if (!token) {
    redirect("/sign-in");
  }

  return token;
}

export async function apiFetch(path: string, init: ApiFetchOptions = {}) {
  const token = await getSessionToken();
  const headers = new Headers(init.headers);

  headers.set("Authorization", `Bearer ${token}`);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return backendApiFetch(path, {
    ...init,
    headers,
  });
}
