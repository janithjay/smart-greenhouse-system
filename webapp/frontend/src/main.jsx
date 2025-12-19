import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { Amplify } from 'aws-amplify';

// Configure Amplify manually since we didn't use the CLI
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
      loginWith: {
        email: true,
        oauth: {
          domain: import.meta.env.VITE_COGNITO_DOMAIN,
          scopes: ['email', 'profile', 'openid'],
          redirectSignIn: [window.location.origin + '/'],
          redirectSignOut: [window.location.origin + '/'],
          responseType: 'code',
          providers: ['Google'],
          options: {
            AdvancedSecurityDataCollectionFlag: false
          }
        }
      }
    }
  }
});

// Add a custom parameter to force account selection
const currentConfig = Amplify.getConfig();
Amplify.configure({
  ...currentConfig,
  Auth: {
    ...currentConfig.Auth,
    Cognito: {
      ...currentConfig.Auth?.Cognito,
      loginWith: {
        ...currentConfig.Auth?.Cognito?.loginWith,
        oauth: {
          ...currentConfig.Auth?.Cognito?.loginWith?.oauth,
          providers: ['Google'],
          customParameters: {
            prompt: 'select_account'
          }
        }
      }
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
