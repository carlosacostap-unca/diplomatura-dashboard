import DashboardClient from "./DashboardClient";
import { getDashboardData } from "@/lib/diplomatura-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getDashboardData();

  return <DashboardClient data={data} />;
}
