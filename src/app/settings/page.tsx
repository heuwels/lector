'use client';

import DataManagement from './components/DataManagement';
import Export from './components/Export';
import KnownWordsImport from './components/KnownWordsImport';
import APITokens from './components/APITokens';
import TwoFactorSettings from './components/TwoFactorSettings';
import Timezone from './components/Timezone';
import ThemeSettings from './components/ThemeSettings';
import AnkiSettings from './components/AnkiSettings';
import TTSSettings from './components/TTSSettings';
import LLMSettings from './components/LLMSettings';
import PracticeSettings from './components/PracticeSettings';
import VersionInfo from './components/VersionInfo';
import DeleteAccount from './components/DeleteAccount';
import PageHeader from '@/components/PageHeader';
import BYOKSettings from './components/BYOKSettings';
import CloudPlanSettings from './components/CloudPlanSettings';
import { lectorMode } from '@/lib/api-base';

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Settings" />
      <div className="space-y-8">
        {lectorMode() === 'cloud' && <CloudPlanSettings />}
        <PracticeSettings />
        {lectorMode() === 'cloud' ? <BYOKSettings /> : <LLMSettings />}
        <AnkiSettings />
        <TTSSettings />
        <ThemeSettings />
        <Timezone />
        <TwoFactorSettings />
        <APITokens />
        <KnownWordsImport />
        <Export />
        <DataManagement />
        <DeleteAccount />
        <VersionInfo />
      </div>
    </main>
  );
}
