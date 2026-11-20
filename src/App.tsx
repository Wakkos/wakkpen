import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { Login } from './pages/Login'
import { MyPens } from './pages/MyPens'
import { Editor } from './pages/Editor'
import { Teacher } from './pages/Teacher'
import { TeacherPen } from './pages/TeacherPen'
import { Students } from './pages/Students'
import { Wall } from './pages/Wall'
import { History } from './pages/History'
import { Popout } from './pages/Popout'
import { Live } from './pages/Live'
import { Sheets } from './pages/Sheets'
import { SheetStudent } from './pages/SheetStudent'
import { TeacherSheets } from './pages/TeacherSheets'
import { SheetTeacher } from './pages/SheetTeacher'
import { ClaudeConnect } from './pages/ClaudeConnect'
import { NotificationsProvider } from './lib/notifications'
import { Bienvenida } from './components/Bienvenida'
import { SessionsProvider } from './lib/sessions'
import { TeacherSessions, SessionTeacher, StudentSessions, SessionStudent } from './pages/Sessions'
import { Join, PendingJoin } from './pages/Join'

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
    <NotificationsProvider>
    <SessionsProvider>
    <Bienvenida />
    <PendingJoin />
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/pens" element={<MyPens />} />
      <Route path="/pen/:id" element={<Editor />} />
      <Route path="/pen/:id/ventana" element={<Popout />} />
      <Route path="/sesiones" element={<StudentSessions />} />
      <Route path="/sesion/:id" element={<SessionStudent />} />
      <Route path="/profesor/sesiones" element={<TeacherOnly><TeacherSessions /></TeacherOnly>} />
      <Route path="/profesor/sesiones/:id" element={<TeacherOnly><SessionTeacher /></TeacherOnly>} />
      <Route path="/ejercicios" element={<Sheets />} />
      <Route path="/ejercicios/:id" element={<SheetStudent />} />
      <Route path="/profesor/ejercicios" element={<TeacherOnly><TeacherSheets /></TeacherOnly>} />
      <Route path="/profesor/ejercicios/:id" element={<TeacherOnly><SheetTeacher /></TeacherOnly>} />
      <Route path="/profesor/claude" element={<TeacherOnly><ClaudeConnect /></TeacherOnly>} />
      <Route path="/profesor" element={<TeacherOnly><Teacher /></TeacherOnly>} />
      <Route path="/profesor/pen/:id" element={<TeacherOnly><TeacherPen /></TeacherOnly>} />
      <Route path="/profesor/alumnos" element={<TeacherOnly><Students /></TeacherOnly>} />
      <Route path="/profesor/muro" element={<TeacherOnly><Wall /></TeacherOnly>} />
      <Route path="/profesor/pen/:id/historial" element={<TeacherOnly><History /></TeacherOnly>} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
    </SessionsProvider>
    </NotificationsProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Vista del móvil por QR: sin login. */}
          <Route path="/live/:token" element={<Live />} />
          {/* Enlace de sesión: funciona con o sin cuenta. */}
          <Route path="/s/:code" element={<Join />} />
          <Route path="*" element={<Gate />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
