import { siteConfig } from "@repo/shared/config";

type LocaleType = "en" | "zh";

// Base URL helper
const getBaseUrl = () => siteConfig.url;

/**
 * WebSite Schema - for site-wide search/branding
 */
export function generateWebSiteSchema(locale: LocaleType) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: getBaseUrl(),
    description:
      locale === "en"
        ? "AI-powered chat-to-image generation platform. Transform your words into stunning visuals through natural conversation."
        : "AI驱动的对话生图平台，通过自然对话将你的想法转化为精美视觉图片。",
    inLanguage: locale === "en" ? "en-US" : "zh-CN",
  };
}

/**
 * Organization Schema - for brand identity
 */
export function generateOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    url: getBaseUrl(),
    logo: `${getBaseUrl()}/logo.png`,
    sameAs: [siteConfig.links.twitter, siteConfig.links.github].filter(Boolean),
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: siteConfig.author.email,
    },
  };
}

/**
 * FAQ Item type
 */
export interface FAQItem {
  question: string;
  answer: string;
}

/**
 * FAQ Schema - for FAQ sections
 */
export function generateFAQSchema(faqs: FAQItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

/**
 * Breadcrumb Item type
 */
export interface BreadcrumbItem {
  name: string;
  url: string;
}

/**
 * Breadcrumb Schema - for navigation
 */
export function generateBreadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url.startsWith("http")
        ? item.url
        : `${getBaseUrl()}${item.url}`,
    })),
  };
}

/**
 * SoftwareApplication Schema - for the product itself
 */
export function generateSoftwareApplicationSchema(locale: LocaleType) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteConfig.name,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    url: getBaseUrl(),
    description:
      locale === "en"
        ? "AI-powered chat-to-image generation platform for creating stunning visuals from natural conversation"
        : "AI驱动的对话生图平台，通过自然对话创建精美视觉图片",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "CNY",
      description: locale === "en" ? "Free tier available" : "提供免费版本",
    },
  };
}
