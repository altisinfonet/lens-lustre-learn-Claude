import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import { BrandHeader } from './BrandHeader.tsx'
import { Disclaimer } from './Disclaimer.tsx'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "50mm Retina World"

interface NotificationAlertProps {
  userName?: string
  notificationType?: string
  message?: string
  actionUrl?: string
  actionLabel?: string
}

const NotificationAlertEmail = ({
  userName,
  notificationType,
  message,
  actionUrl,
  actionLabel,
}: NotificationAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{message || `You have a new notification on ${SITE_NAME}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Heading style={h1}>
          {userName ? `Hi ${userName},` : 'Hi there,'}
        </Heading>
        <Text style={label}>
          {notificationType || 'Notification'}
        </Text>
        <Text style={text}>
          {message || 'You have a new update on your account.'}
        </Text>
        {actionUrl && (
          <Button style={button} href={actionUrl}>
            {actionLabel || 'View on 50mm Retina World'}
          </Button>
        )}
        <Hr style={hr} />
        <Text style={footer}>
          You're receiving this because you have an account on {SITE_NAME}.
        </Text>
              <Disclaimer />
        </Container>
    </Body>
  </Html>
)

export const template = {
  component: NotificationAlertEmail,
  subject: (data: Record<string, any>) =>
    data.notificationType
      ? `${data.notificationType} — ${SITE_NAME}`
      : `New notification — ${SITE_NAME}`,
  displayName: 'Notification Alert',
  previewData: {
    userName: 'Jane',
    notificationType: 'New Reaction',
    message: 'Someone reacted to your photo',
    actionUrl: 'https://www.50mmretina.com/feed',
    actionLabel: 'View Now',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#1c2d41', margin: '0 0 8px' }
const label = { fontSize: '11px', fontWeight: '600' as const, color: '#0284c7', letterSpacing: '0.1em', textTransform: 'uppercase' as const, margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#4b5563', lineHeight: '1.6', margin: '0 0 24px' }
const button = { backgroundColor: '#0284c7', color: '#f0f9ff', padding: '12px 28px', borderRadius: '8px', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none' }
const hr = { borderColor: '#e5e7eb', margin: '28px 0 16px' }
const footer = { fontSize: '12px', color: '#9ca3af', lineHeight: '1.5', margin: '0' }
