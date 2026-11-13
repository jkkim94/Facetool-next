import './globals.css'

export const metadata = {
  title: 'FaceTool',
  description: 'Audio2Face - Dataset Validation, Training Evaluation, Service',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
