import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { installGlobalHandlers } from './lib/errors.js';
import './styles.css';

installGlobalHandlers();
createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
