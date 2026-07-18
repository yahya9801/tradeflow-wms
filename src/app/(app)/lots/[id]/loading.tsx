import { Skeleton } from "@/components/ui/skeleton";

export default function LotDetailLoading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Skeleton className="h-4 w-16" />

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-16 rounded-lg" />
      </div>

      <Skeleton className="h-16 w-full rounded-xl" />

      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border p-5">
            <Skeleton className="h-3 w-24" />
            {Array.from({ length: 4 }).map((__, j) => (
              <Skeleton key={j} className="h-4 w-full" />
            ))}
          </div>
        ))}
      </div>

      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}
