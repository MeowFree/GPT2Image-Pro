import {
  EPAY_TRADE_SUCCESS,
  isRuntimeEpayConfigured,
  parseEpayRequestParams,
  verifyRuntimeEpayParams,
} from "@repo/shared/payment/epay";
import { withApiLogging } from "@repo/shared/api-logger";
import { logger, logError } from "@repo/shared/logger";
import { fulfillSuccessfulEpayPayment } from "@/features/payment/epay-fulfillment";

export const GET = withApiLogging(handleEpayWebhook);
export const POST = withApiLogging(handleEpayWebhook);

async function handleEpayWebhook(req: Request) {
  if (!(await isRuntimeEpayConfigured())) {
    logger.warn({ source: "epay-webhook" }, "Epay is not configured");
    return new Response("fail", { status: 200 });
  }

  const params = await parseEpayRequestParams(req);
  const verifyInfo = await verifyRuntimeEpayParams(params);

  if (!verifyInfo.verifyStatus) {
    logger.warn(
      { source: "epay-webhook", outTradeNo: verifyInfo.outTradeNo },
      "Invalid Epay signature"
    );
    return new Response("fail", { status: 200 });
  }

  if (verifyInfo.tradeStatus !== EPAY_TRADE_SUCCESS) {
    logger.info(
      {
        source: "epay-webhook",
        outTradeNo: verifyInfo.outTradeNo,
        tradeStatus: verifyInfo.tradeStatus,
      },
      "Ignoring non-success Epay event"
    );
    return new Response("success", { status: 200 });
  }

  try {
    await fulfillSuccessfulEpayPayment(verifyInfo, "epay-webhook");
  } catch (error) {
    logError(error, {
      source: "epay-webhook",
      outTradeNo: verifyInfo.outTradeNo,
    });
    return new Response("fail", { status: 200 });
  }

  return new Response("success", { status: 200 });
}
