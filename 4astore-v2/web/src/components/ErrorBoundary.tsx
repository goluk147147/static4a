import { Component, ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Catches render errors so a single page can't blank the whole app. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, maxWidth: 700, margin: '40px auto', fontFamily: 'monospace' }}>
          <h2 style={{ color: '#c62828' }}>Something went wrong on this page</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#fff3f3', padding: 16, borderRadius: 8, color: '#900' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 12, padding: '8px 16px' }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
