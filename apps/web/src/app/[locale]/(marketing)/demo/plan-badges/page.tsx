import {
  PlanBadge,
  type PlanType,
} from "@repo/shared/subscription/components/plan-badge";

const plans: PlanType[] = ["free", "starter", "pro", "ultra", "enterprise"];
const sizes: Array<"xs" | "sm" | "md" | "lg"> = ["xs", "sm", "md", "lg"];

export default function PlanBadgesDemoPage() {
  return (
    <section className="container py-16">
      <div className="mx-auto flex max-w-4xl flex-col gap-10">
        <header className="space-y-3">
          <h1 className="font-serif text-3xl font-medium tracking-tight">
            Plan Badge Demo
          </h1>
          <p className="leading-relaxed text-muted-foreground">
            Preview the subscription badge styles across plans and sizes.
          </p>
        </header>

        <div className="space-y-8">
          {sizes.map((size) => (
            <div
              key={size}
              className="space-y-3 rounded-lg border border-border bg-background p-6"
            >
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Size: {size.toUpperCase()}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {plans.map((plan) => (
                  <PlanBadge key={`${plan}-${size}`} plan={plan} size={size} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
