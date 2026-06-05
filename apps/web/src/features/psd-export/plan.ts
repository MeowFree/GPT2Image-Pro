/**
 * PSD 导出的图层计划(纯逻辑)。
 *
 * 职责:把用户的导出选项(是否抠主体、附加哪些元素)解析为一份"有序图层作业"列表,
 * 供编排层据此逐层产出图层位图,最后交给 assembleLayeredPsd 组装。
 * 顺序约定:数组下标越小越靠底层(background 永远在最底)。
 *
 * 设计:纯函数、无副作用,便于 DB-free 单测。这里只做"该有哪些层、什么顺序、叫什么名、
 * 是否合法",不做任何生成/存储/扣费。成本控制(图层上限)也在此把关。
 */

/** 一个附加元素的规格(用户填写)。 */
export type PsdElementSpec = {
  /** 图层名;留空时自动命名为 element-N。 */
  name?: string;
  /** 该元素的生成提示词(透明背景单独生成)。 */
  prompt: string;
};

/** 导出选项。 */
export type PsdExportPlanInput = {
  /** 是否把底图主体抠成单独的透明图层。 */
  isolateSubject?: boolean;
  /** 附加元素,各自透明生成为一层,按数组顺序自底向上叠加。 */
  elements?: PsdElementSpec[];
};

/** 一份图层作业:告诉编排层该层从哪来。 */
export type PsdLayerJob =
  | { role: "background"; name: string }
  | { role: "subject"; name: string }
  | { role: "element"; name: string; prompt: string };

/** 附加图层(主体 + 元素)总数上限,控制单次导出的生成成本。 */
export const MAX_PSD_EXTRA_LAYERS = 6;
/** 单个元素提示词长度上限。 */
export const MAX_PSD_ELEMENT_PROMPT = 1000;

/**
 * 解析导出选项为有序图层作业列表(底层在前)。
 *
 * @throws 元素提示词为空/过长、或附加图层超过上限时抛错。
 */
export function planPsdLayers(input: PsdExportPlanInput): PsdLayerJob[] {
  // 底图始终作为最底的背景层,且不产生新的生成/扣费。
  const jobs: PsdLayerJob[] = [{ role: "background", name: "background" }];
  const usedNames = new Set<string>(["background"]);
  let extraCount = 0;

  if (input.isolateSubject) {
    extraCount += 1;
    jobs.push({ role: "subject", name: "subject" });
    usedNames.add("subject");
  }

  const elements = input.elements ?? [];
  elements.forEach((element, index) => {
    const prompt = element.prompt?.trim() ?? "";
    if (!prompt) {
      throw new Error(`第 ${index + 1} 个元素的描述不能为空`);
    }
    if (prompt.length > MAX_PSD_ELEMENT_PROMPT) {
      throw new Error(
        `第 ${index + 1} 个元素描述过长(上限 ${MAX_PSD_ELEMENT_PROMPT} 字)`
      );
    }
    extraCount += 1;
    if (extraCount > MAX_PSD_EXTRA_LAYERS) {
      throw new Error(`附加图层不能超过 ${MAX_PSD_EXTRA_LAYERS} 个`);
    }

    // 取唯一、稳定的层名:用户名优先,冲突或留空则回退/加序号后缀。
    const desired = element.name?.trim() || `element-${index + 1}`;
    let name = desired;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${desired}-${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);
    jobs.push({ role: "element", name, prompt });
  });

  return jobs;
}
