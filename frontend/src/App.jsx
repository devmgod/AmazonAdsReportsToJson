import { lazy, Suspense } from 'react'
import './App.css'

// Lazy load Dashboard component for code splitting
const Dashboard = lazy(() => import('./components/Dashboard'))

function App() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    }>
      <Dashboard />
    </Suspense>
  )
}

export default App
