import { db } from "@repo/database";
import { creditsBalance, generation } from "@repo/database/schema";
import { auth } from "@repo/shared/auth";
import { formatCredits } from "@repo/shared/credits/format";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { and, count, desc, eq } from "drizzle-orm";
import { Coins, Image as ImageIcon, ImagePlus } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/routing";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const user = session.user;
  const userId = user.id;

  const [balanceData, recentGenerations, totalGenerationsResult] =
    await Promise.all([
      db.query.creditsBalance.findFirst({
        where: eq(creditsBalance.userId, userId),
      }),
      db
        .select()
        .from(generation)
        .where(
          and(eq(generation.userId, userId), eq(generation.status, "completed"))
        )
        .orderBy(desc(generation.createdAt))
        .limit(4),
      db
        .select({ count: count() })
        .from(generation)
        .where(eq(generation.userId, userId)),
    ]);

  const balance = formatCredits(balanceData?.balance ?? 0);
  const totalGenerations = totalGenerationsResult[0]?.count ?? 0;

  const generationsWithUrls = recentGenerations.map((gen) => ({
    ...gen,
    imageUrl: gen.storageKey
      ? process.env.STORAGE_ENDPOINT
        ? `/image-proxy/${gen.storageBucket}/${gen.storageKey}`
        : `/api/storage/${gen.storageBucket}/${gen.storageKey}`
      : null,
  }));

  return (
    <div className="container mx-auto px-4 py-6 md:px-6">
      <div className="space-y-8">
        {/* Page header */}
        <div>
          <h1 className="font-serif text-2xl font-medium">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, {user.name}</p>
        </div>

        {/* Stats row */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Credits Balance Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Credits Balance
              </CardTitle>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{balance}</div>
              <p className="text-xs text-muted-foreground">
                Pixel-based pricing, 4K base 10 credits
              </p>
            </CardContent>
          </Card>

          {/* Images Generated Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Images Generated
              </CardTitle>
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalGenerations}</div>
              <p className="text-xs text-muted-foreground">
                total images created
              </p>
            </CardContent>
          </Card>

          {/* Quick Create Card */}
          <Card className="border-dashed">
            <CardContent className="flex h-full flex-col items-center justify-center gap-3 p-6">
              <ImagePlus className="h-8 w-8 text-muted-foreground" />
              <Button asChild>
                <Link href="/dashboard/create">Start Creating</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Recent Generations */}
        {generationsWithUrls.length > 0 && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-lg font-medium">
                Recent Creations
              </h2>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/gallery">View All</Link>
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {generationsWithUrls.map((gen) => (
                <Link key={gen.id} href="/dashboard/gallery" className="group">
                  <Card className="overflow-hidden transition-shadow hover:shadow-md">
                    <div className="relative aspect-square">
                      {gen.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={gen.imageUrl}
                          alt={gen.prompt}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-muted">
                          <ImageIcon className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <CardContent className="p-3">
                      <p className="truncate text-sm text-muted-foreground">
                        {gen.prompt}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
