"use client"

import React from "react"

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Editor Error:", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div style={{ padding: 20, color: "white", background: "#dc2626" }}>
            <h2>Editor Error</h2>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {this.state.error?.message}
              {"\n\n"}
              {this.state.error?.stack}
            </pre>
          </div>
        )
      )
    }

    return this.props.children
  }
}
