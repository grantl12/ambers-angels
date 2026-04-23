import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import LandingPage from "@/components/LandingPage"

export default async function HomePage() {
  const cookieStore = await cookies()
  if (cookieStore.get("aa_token")) redirect("/map")
  return <LandingPage />
}
