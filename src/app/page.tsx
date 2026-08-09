import { redirect } from "next/navigation";
import { authenticate } from "@/server/auth/auth";

export default async function HomePage() {
    const session = await authenticate();
    redirect(session ? "/canvas" : "/auth/sign-in");
}
