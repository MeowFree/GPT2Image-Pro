import Image from "next/image";

/**
 * 认证页面 Logo 组件
 *
 * 用于登录、注册等认证页面的品牌标识展示
 * 图标 + 文字组合
 */

export function AuthLogo() {
  return (
    <div className="flex items-center gap-2">
      <Image
        src="/assets/icon.png"
        alt="GPT2IMAGE"
        width={28}
        height={28}
        className="shrink-0"
      />
      <span className="font-serif text-xl font-medium tracking-tight">
        GPT2IMAGE
      </span>
    </div>
  );
}
