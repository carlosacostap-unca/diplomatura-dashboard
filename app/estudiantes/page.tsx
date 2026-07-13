import StudentsClient from "./StudentsClient";
import { getStudentProfiles } from "@/lib/diplomatura-data";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const students = await getStudentProfiles();

  return <StudentsClient students={students} />;
}
