import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import './index.css'
import 'remixicon/fonts/remixicon.css'
import App from './App.tsx'
import { SubjectPage } from './pages/SubjectPage.tsx'
import { GraphExplorerPage } from './pages/GraphExplorerPage.tsx'

const router = createHashRouter([
  { path: '/', element: <App /> },
  { path: '/subject', element: <SubjectPage /> },
  { path: '/graphs', element: <GraphExplorerPage /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
