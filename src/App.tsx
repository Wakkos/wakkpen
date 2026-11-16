import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { Login } from './pages/Login'
import { MyPens } from './pages/MyPens'
import { Editor } from './pages/Editor'
import { Teacher } from './pages/Teacher'
import { TeacherPen } from './pages/TeacherPen'
import { Students } from './pages/Students'

function TeacherOnly({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  return profile?.role === 'teacher' ? <>{children}</> : <Navigate to="/pens" replace />
}

function Gate() {
  const { session, profile, loading } = useAuth()
  if (loading || (session && !profile)) return <div className="app-loading" />
  if (!session) return <Login />
  const home = profile?.role === 'teacher' ? '/profesor' : '/pens'
  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/pens" element={<MyPens />} />
      <Route path="/pen/:id" element={<Editor />} />
      <Route path="/profesor" element={<TeacherOnly><Teacher /></TeacherOnly>} />
      <Route path="/profesor/pen/:id" element={<TeacherOnly><TeacherPen /></TeacherOnly>} />
      <Route path="/profesor/alumnos" element={<TeacherOnly><Students /></TeacherOnly>} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  )
}
