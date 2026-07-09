/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Hr, Section, Text } from 'npm:@react-email/components@0.0.22'

/**
 * Shared automated-email disclaimer + support routing note.
 * Rendered at the bottom of every transactional and auth email.
 */
export const Disclaimer: React.FC = () => (
  <Section style={wrap}>
    <Hr style={hr} />
    <Text style={line}>
      This is an automated message from <strong>50mm Retina World</strong>. Please do not reply — this inbox is not monitored.
    </Text>
    <Text style={line}>
      Need help or spotted an issue? Sign in to your account and raise a support ticket from the <strong>Help &amp; Support</strong> section. Our team will get back to you as quickly as possible.
    </Text>
  </Section>
)

const wrap: React.CSSProperties = {
  marginTop: '32px',
}

const hr: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '24px 0 16px',
}

const line: React.CSSProperties = {
  fontSize: '11px',
  color: '#9ca3af',
  lineHeight: '1.6',
  margin: '0 0 8px',
}
