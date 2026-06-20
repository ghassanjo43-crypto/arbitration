import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PublicLayout } from './components/layout/PublicLayout';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Home } from './pages/Home';
import { ArbitratorDirectory } from './pages/ArbitratorDirectory';
import { ArbitratorProfile } from './pages/ArbitratorProfile';
import { FeeCalculator } from './pages/FeeCalculator';
import { FileACase } from './pages/FileACase';
import { SignIn } from './pages/SignIn';
import { News, CourtHighlights, Publications } from './pages/content';
import { Register, ForgotPassword, LawyerRegistration } from './pages/auth-extra';
import {
  About, HowItWorks, Rules, ModelClause, SubmissionAgreement,
  Faq, Contact, Privacy, Terms, NotFound,
} from './pages/static';
import { Dashboard } from './pages/app/Dashboard';
import { CaseWorkspace } from './pages/app/CaseWorkspace';
import { AdminContent } from './pages/app/AdminContent';
import { AdminUsers } from './pages/app/AdminUsers';
import { VerifyEmail } from './pages/VerifyEmail';
import { RulesFull } from './pages/RulesFull';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="about" element={<About />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="rules" element={<Rules />} />
          <Route path="rules/full" element={<RulesFull />} />
          {/* Arbitrator directory requires sign-in (still inside the public layout). */}
          <Route element={<ProtectedRoute />}>
            <Route path="arbitrators" element={<ArbitratorDirectory />} />
            <Route path="arbitrators/:id" element={<ArbitratorProfile />} />
          </Route>
          <Route path="fee-calculator" element={<FeeCalculator />} />
          <Route path="file-a-case" element={<FileACase />} />
          <Route path="lawyer-registration" element={<LawyerRegistration />} />
          <Route path="news" element={<News />} />
          <Route path="court-highlights" element={<CourtHighlights />} />
          <Route path="publications" element={<Publications />} />
          <Route path="model-clause" element={<ModelClause />} />
          <Route path="submission-agreement" element={<SubmissionAgreement />} />
          <Route path="faq" element={<Faq />} />
          <Route path="contact" element={<Contact />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="terms" element={<Terms />} />
          <Route path="sign-in" element={<SignIn />} />
          <Route path="register" element={<Register />} />
          <Route path="verify-email" element={<VerifyEmail />} />
          <Route path="forgot-password" element={<ForgotPassword />} />

          <Route path="app" element={<ProtectedRoute />}>
            <Route index element={<Dashboard />} />
            <Route path="cases/:id" element={<CaseWorkspace />} />
            <Route path="admin/content" element={<AdminContent />} />
            <Route path="admin/users" element={<AdminUsers />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
