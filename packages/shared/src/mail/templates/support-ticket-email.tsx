import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

interface SupportTicketNotificationEmailProps {
  title: string;
  subject: string;
  ticketUrl: string;
  userName?: string | null | undefined;
  userEmail?: string | null | undefined;
  category?: string | undefined;
  priority?: string | undefined;
  messagePreview?: string | undefined;
}

export function SupportTicketNotificationEmail({
  title,
  subject,
  ticketUrl,
  userName,
  userEmail,
  category,
  priority,
  messagePreview,
}: SupportTicketNotificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 max-w-xl rounded-lg border border-solid border-gray-200 p-8">
            <Section className="mb-8 text-center">
              <Heading className="m-0 text-2xl font-bold text-gray-900">
                GPT2IMAGE
              </Heading>
            </Section>

            <Section className="mb-6">
              <Heading className="mb-4 text-xl font-semibold text-gray-900">
                {title}
              </Heading>
              <Text className="mb-3 text-base leading-relaxed text-gray-700">
                工单：{subject}
              </Text>
              {(userName || userEmail) && (
                <Text className="mb-3 text-sm leading-relaxed text-gray-600">
                  用户：{userName || "未命名用户"}
                  {userEmail ? ` <${userEmail}>` : ""}
                </Text>
              )}
              {(category || priority) && (
                <Text className="mb-3 text-sm leading-relaxed text-gray-600">
                  {category ? `类别：${category}` : ""}
                  {category && priority ? " / " : ""}
                  {priority ? `优先级：${priority}` : ""}
                </Text>
              )}
              {messagePreview && (
                <Section className="mt-4 rounded-lg bg-gray-50 p-4">
                  <Text className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                    {messagePreview}
                  </Text>
                </Section>
              )}
            </Section>

            <Section className="mb-6 text-center">
              <Button
                href={ticketUrl}
                className="inline-block rounded-md bg-gray-900 px-6 py-3 text-center text-sm font-semibold text-white no-underline"
              >
                查看工单
              </Button>
            </Section>

            <Section className="mb-6 rounded-lg bg-gray-50 p-4">
              <Text className="m-0 mb-2 text-xs text-gray-600">
                如果按钮无法打开，请复制下面的地址：
              </Text>
              <Text className="m-0 break-all text-xs text-gray-600 underline">
                {ticketUrl}
              </Text>
            </Section>

            <Hr className="my-6 border-gray-200" />
            <Text className="m-0 text-center text-xs text-gray-400">
              &copy; {new Date().getFullYear()} GPT2IMAGE. All rights reserved.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default SupportTicketNotificationEmail;
