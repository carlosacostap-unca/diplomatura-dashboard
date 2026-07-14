import DataQualityClient from "./DataQualityClient";
import { getDashboardData } from "@/lib/diplomatura-data";

export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  const data = await getDashboardData();

  return <DataQualityClient data={data} />;
}
