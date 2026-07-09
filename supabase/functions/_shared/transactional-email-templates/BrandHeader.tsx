/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Img, Section, Link } from 'npm:@react-email/components@0.0.22'

/**
 * Shared 50mm Retina World brand header for ALL transactional email
 * templates. Renders a small logo (140x40) linking back to the site.
 *
 * The logo URL is the same one used by all auth email templates
 * (supabase/functions/_shared/email-templates/*.tsx) — single source of
 * truth, verified reachable (HTTP 200, image/png) on 2026-05-02.
 */
const LOGO_URL =
  'https://isywidnfnjhtydmdfgtk.supabase.co/storage/v1/object/public/email-assets/logo.png'

const SITE_URL = 'https://www.50mmretina.com'

export const BrandHeader: React.FC = () => (
  <Section style={wrap}>
    <Link href={SITE_URL} style={link}>
      <Img
        src={LOGO_URL}
        alt="50mm Retina World"
        width="64"
        height="64"
        style={img}
      />
    </Link>
  </Section>
)

const wrap: React.CSSProperties = {
  textAlign: 'center',
  padding: '8px 0 24px',
  borderBottom: '1px solid #f1f1f1',
  marginBottom: '24px',
}

const link: React.CSSProperties = {
  display: 'inline-block',
  textDecoration: 'none',
}

const img: React.CSSProperties = {
  display: 'inline-block',
  width: '64px',
  height: '64px',
  border: 0,
  outline: 'none',
}
