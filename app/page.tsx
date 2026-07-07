import DashboardClient from "./DashboardClient";
import { getDashboardData } from "@/lib/diplomatura-data";

export default function Home() {
  const data = getDashboardData();

  return <DashboardClient data={data} />;
}
