import React from 'react';

type ErrorBoundaryState = {
  hasError: boolean;
};

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Erro nao tratado na interface:', error);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: '#f8fafc'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '520px',
              background: '#ffffff',
              borderRadius: '18px',
              padding: '24px',
              boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)'
            }}
          >
            <h1 style={{ margin: '0 0 12px', fontSize: '1.4rem', color: '#0f172a' }}>
              O aplicativo encontrou um erro
            </h1>
            <p style={{ margin: '0 0 18px', color: '#475569', lineHeight: 1.5 }}>
              A interface foi protegida para evitar tela branca. Recarregue a pagina para continuar.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                border: 'none',
                borderRadius: '12px',
                padding: '12px 16px',
                background: '#0f172a',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Recarregar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
