import Link from "next/link";

export default function StudentNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f1115] px-4 text-[#f4f1ea]">
      <div className="max-w-md rounded-lg border border-[#303741] bg-[#181c22] p-8 text-center">
        <p className="text-sm font-semibold uppercase text-[#5ee0c1]">
          Estudiante no encontrado
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-[#fbf7ef]">
          El historial solicitado no está disponible
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#aab4c0]">
          La persona pudo haber sido eliminada o el enlace no corresponde al
          padrón actual.
        </p>
        <Link
          href="/estudiantes"
          className="mt-6 inline-flex h-10 items-center rounded-md bg-[#1f9d82] px-4 text-sm font-semibold text-[#06110f] transition hover:bg-[#5ee0c1]"
        >
          Volver a Estudiantes
        </Link>
      </div>
    </main>
  );
}
