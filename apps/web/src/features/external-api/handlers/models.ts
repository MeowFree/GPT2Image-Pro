import { withApiLogging } from "@repo/shared/api-logger";
import { type NextRequest, NextResponse } from "next/server";

import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import { authenticateExternalApiRequest } from "@repo/shared/external-api/auth";
import { getExternalModelsForUser } from "@repo/image-generation/external-api-models";

function openAIError(message: string, status = 400, code?: string) {
  return NextResponse.json(
    {
      error: {
        message,
        type: "invalid_request_error",
        code: code || null,
      },
    },
    { status }
  );
}

export const getExternalModels = withApiLogging(
  async (request: NextRequest) => {
    const auth = await authenticateExternalApiRequest(request);
    if (!auth) {
      return openAIError("Invalid or missing API key", 401, "invalid_api_key");
    }
    if (!(await canUsePlanCapability(auth.plan, "externalApi.models.list"))) {
      return openAIError(
        "External API model listing is not enabled for this plan.",
        403,
        "insufficient_plan"
      );
    }

    return NextResponse.json(await getExternalModelsForUser(auth.userId), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
);
