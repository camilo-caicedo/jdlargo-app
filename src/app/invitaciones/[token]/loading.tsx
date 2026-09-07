import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 flex flex-col items-center justify-center p-4 sm:p-6">
      <header className="mb-6 text-center">
        <Skeleton className="h-5 w-28 mx-auto mb-2" />
        <Skeleton className="h-3 w-48 mx-auto" />
      </header>
      <main className="w-full max-w-[440px]">
        <Card className="shadow-sm">
          <CardHeader className="text-center pb-4">
            <Skeleton className="h-6 w-3/4 mx-auto mb-2" />
            <Skeleton className="h-4 w-5/6 mx-auto" />
          </CardHeader>
          <div className="p-6 space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full mt-6" />
          </div>
        </Card>
      </main>
    </div>
  );
}
