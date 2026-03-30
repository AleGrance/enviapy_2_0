'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Megaphone,
  Paperclip,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { campaignsApi, numbersApi } from '../services/api';

type Role = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'CLIENT';

interface SessionUser {
  id: string;
  email: string;
  role: Role;
  tenantId: string;
  numberId?: string | null;
  campaignsEnabled?: boolean;
}

interface NumberItem {
  id: string;
  name: string;
  phoneNumber?: string | null;
  status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';
}

interface CampaignItem {
  id: string;
  name: string;
  text?: string | null;
  recipientsFileName: string;
  recipientsFilePath: string;
  status: 'PENDING' | 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  totalRecipients: number;
  processedRecipients: number;
  sentRecipients: number;
  deliveredRecipients: number;
  readRecipients: number;
  respondedRecipients: number;
  failedRecipients: number;
  createdAt: string;
  scheduledAt?: string | null;
  completedAt?: string | null;
  number: {
    id: string;
    name: string;
    phoneNumber?: string | null;
  };
  createdBy: {
    id: string;
    email: string;
  };
  attachments: Array<{
    id: string;
    originalName: string;
    storagePath: string;
    mimeType: string;
    size: number;
  }>;
  recipients: Array<{
    id: string;
    phoneNumber: string;
    status: 'PENDING' | 'SENT' | 'FAILED';
  }>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function toDateTimeLocalValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function buildCopiedCampaignName(name: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${name} - copia - ${year}-${month}-${day}`;
}

function formatCampaignStatus(status: CampaignItem['status']) {
  return {
    PENDING: 'Pendiente',
    SCHEDULED: 'Programada',
    PROCESSING: 'En proceso',
    COMPLETED: 'Completada',
    PARTIAL: 'Parcial',
    FAILED: 'Fallida',
  }[status];
}

export default function CampaignsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [numbers, setNumbers] = useState<NumberItem[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [sourceCampaign, setSourceCampaign] = useState<CampaignItem | null>(null);
  const [campaignSearch, setCampaignSearch] = useState('');

  const [name, setName] = useState('');
  const [numberId, setNumberId] = useState('');
  const [text, setText] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [recipientsFile, setRecipientsFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [recipientsInputKey, setRecipientsInputKey] = useState(0);
  const [attachmentsInputKey, setAttachmentsInputKey] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const rawUser = localStorage.getItem('user');

    if (!token || !rawUser) {
      router.replace('/login');
      return;
    }

    try {
      const parsedUser = JSON.parse(rawUser) as SessionUser;
      if (!parsedUser.campaignsEnabled) {
        router.replace('/');
        return;
      }

      setCurrentUser(parsedUser);
      void loadInitialData(parsedUser);
    } catch {
      localStorage.clear();
      router.replace('/login');
    }
  }, [router]);

  useEffect(() => {
    if (!currentUser) return;

    const intervalId = window.setInterval(() => {
      void refreshCampaigns();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [currentUser, campaignSearch]);

  useEffect(() => {
    if (!currentUser) return;
    void refreshCampaigns();
  }, [campaignSearch]);

  useEffect(() => {
    if (!isCreateModalOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        setIsCreateModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isCreateModalOpen, saving]);

  const loadInitialData = async (sessionUser: SessionUser) => {
    setLoading(true);
    setError('');

    try {
      try {
        await numbersApi.bootstrap();
      } catch {
        // Best-effort bootstrap; statuses will still be fetched below.
      }

      const [numbersData, campaignsData] = await Promise.all([
        numbersApi.getAll(),
        campaignsApi.getAll(campaignSearch),
      ]);

      setNumbers(numbersData);
      setCampaigns(campaignsData);
      setNumberId((current) => current || sessionUser.numberId || numbersData[0]?.id || '');
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo cargar el modulo de campañas.');
    } finally {
      setLoading(false);
    }
  };

  const refreshCampaigns = async () => {
    try {
      const [numbersData, campaignsData] = await Promise.all([
        numbersApi.getAll(),
        campaignsApi.getAll(campaignSearch),
      ]);
      setNumbers(numbersData);
      setCampaigns(campaignsData);
    } catch {
      // Silent refresh to keep progress updated.
    }
  };

  const handleRecipientsFile = (event: ChangeEvent<HTMLInputElement>) => {
    setRecipientsFile(event.target.files?.[0] || null);
  };

  const handleAttachments = (event: ChangeEvent<HTMLInputElement>) => {
    setAttachments(Array.from(event.target.files || []));
  };

  const resetForm = () => {
    setName('');
    setText('');
    setScheduledAt('');
    setRecipientsFile(null);
    setAttachments([]);
    setSourceCampaign(null);
    setRecipientsInputKey((value) => value + 1);
    setAttachmentsInputKey((value) => value + 1);
  };

  const closeCreateModal = () => {
    if (saving) return;
    setIsCreateModalOpen(false);
  };

  const openCreateModal = (campaign?: CampaignItem) => {
    setError('');
    setSuccess('');
    if (campaign) {
      setSourceCampaign(campaign);
      setName(buildCopiedCampaignName(campaign.name));
      setNumberId(campaign.number.id);
      setText(campaign.text || '');
      setScheduledAt(
        campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now()
          ? toDateTimeLocalValue(campaign.scheduledAt)
          : '',
      );
      setRecipientsFile(null);
      setAttachments([]);
      setRecipientsInputKey((value) => value + 1);
      setAttachmentsInputKey((value) => value + 1);
    } else {
      resetForm();
      setNumberId((current) => current || currentUser?.numberId || numbers[0]?.id || '');
    }
    setIsCreateModalOpen(true);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    const normalizedText = text.replace(/\r\n/g, '\n');
    const hasMessageText = normalizedText.trim().length > 0;

    if (!name.trim()) {
      setError('Debes indicar un nombre para la campaña.');
      return;
    }

    if (!numberId) {
      setError('Selecciona el numero desde el que se enviara la campaña.');
      return;
    }

    const selectedNumber = numbers.find((item) => item.id === numberId);
    if (selectedNumber && selectedNumber.status !== 'CONNECTED') {
      setError('El numero seleccionado aun no esta conectado. Espera a que la sesion quede CONNECTED y vuelve a intentar.');
      return;
    }

    if (!recipientsFile && !sourceCampaign) {
      setError('Debes subir un archivo csv, xls o xlsx con los destinatarios.');
      return;
    }

    if (!hasMessageText && attachments.length === 0 && !sourceCampaign?.attachments.length) {
      setError('Escribe un texto o adjunta al menos un archivo.');
      return;
    }

    const imageFiles = attachments.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length > 5) {
      setError('Puedes subir hasta 5 imagenes por campaña.');
      return;
    }

    const oversizedImage = imageFiles.find((file) => file.size > 5 * 1024 * 1024);
    if (oversizedImage) {
      setError(`La imagen ${oversizedImage.name} supera el limite de 5 MB.`);
      return;
    }

    const form = new FormData();
    form.append('name', name.trim());
    form.append('numberId', numberId);
    if (sourceCampaign) {
      form.append('sourceCampaignId', sourceCampaign.id);
    }
    if (hasMessageText) {
      form.append('text', normalizedText);
    }
    if (scheduledAt) {
      form.append('scheduledAt', new Date(scheduledAt).toISOString());
    }
    if (recipientsFile) {
      form.append('recipientsFile', recipientsFile);
    }
    attachments.forEach((file) => form.append('attachments', file));

    setSaving(true);
    try {
      await campaignsApi.create(form);
      resetForm();
      setIsCreateModalOpen(false);
      setSuccess(
        sourceCampaign
          ? 'Campaña creada a partir de otra existente. Los envios avanzaran cada 10 segundos por destinatario.'
          : 'Campaña creada correctamente. Los envios avanzaran cada 10 segundos por destinatario.',
      );
      await refreshCampaigns();
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo crear la campaña.');
    } finally {
      setSaving(false);
    }
  };

  const statusClassName = (status: CampaignItem['status']) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-500/20 text-emerald-300';
      case 'PARTIAL':
        return 'bg-amber-500/20 text-amber-300';
      case 'FAILED':
        return 'bg-red-500/20 text-red-300';
      case 'PROCESSING':
        return 'bg-blue-500/20 text-blue-300';
      case 'SCHEDULED':
        return 'bg-violet-500/20 text-violet-300';
      default:
        return 'bg-gray-500/20 text-gray-300';
    }
  };

  const getProgress = (campaign: CampaignItem) => {
    if (!campaign.totalRecipients) return 0;
    return Math.round((campaign.processedRecipients / campaign.totalRecipients) * 100);
  };

  return (
    <main className="min-h-screen bg-[#0b141a] px-4 py-6 text-white md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-2 rounded-lg bg-[#202c33] px-3 py-2 text-sm text-gray-200 hover:bg-[#2a3942]"
          >
            <ArrowLeft size={16} />
            Volver al chat
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Plus size={16} />
              Nueva campaña
            </button>

            <div className="text-right">
              <p className="text-xs text-gray-400">Modulo de campañas</p>
              <p className="text-sm">{currentUser?.email}</p>
            </div>
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">
            {success}
          </p>
        )}

        <section className="rounded-xl border border-[#2a3942] bg-[#111b21] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Listado de campañas</h2>
              <p className="text-xs text-gray-400">
                Resumen con seguimiento de enviados, entregados, leidos, respondidos y fallidos.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={campaignSearch}
                  onChange={(event) => setCampaignSearch(event.target.value)}
                  placeholder="Buscar por nombre o texto"
                  className="w-full min-w-[260px] rounded-lg border border-[#2a3942] bg-[#202c33] py-2 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-green-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="animate-spin text-gray-400" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-center text-gray-500">
              <Megaphone size={32} className="opacity-40" />
              <p>Aun no hay campañas registradas.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((campaign) => {
                const progress = getProgress(campaign);
                const isExpanded = expandedCampaignId === campaign.id;

                return (
                  <article key={campaign.id} className="rounded-xl border border-[#22313a] bg-[#0f171c]">
                    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-semibold text-white">{campaign.name}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-xs ${statusClassName(campaign.status)}`}>
                            {formatCampaignStatus(campaign.status)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                          <span>Creada: {new Date(campaign.createdAt).toLocaleString()}</span>
                          {campaign.scheduledAt && (
                            <span>Programada: {new Date(campaign.scheduledAt).toLocaleString()}</span>
                          )}
                        </div>
                        <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
                          <span>Progreso</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[#1a2830]">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-gray-400">
                          Procesados {campaign.processedRecipients} de {campaign.totalRecipients} destinatarios
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-300 sm:grid-cols-3 xl:grid-cols-5">
                        <div className="rounded-lg bg-[#152028] px-3 py-2">
                          <p className="text-gray-500">Enviados</p>
                          <p className="mt-1 text-sm text-emerald-300">{campaign.sentRecipients}</p>
                        </div>
                        <div className="rounded-lg bg-[#152028] px-3 py-2">
                          <p className="text-gray-500">Entregados</p>
                          <p className="mt-1 text-sm text-sky-300">{campaign.deliveredRecipients}</p>
                        </div>
                        <div className="rounded-lg bg-[#152028] px-3 py-2">
                          <p className="text-gray-500">Leidos</p>
                          <p className="mt-1 text-sm text-cyan-300">{campaign.readRecipients}</p>
                        </div>
                        <div className="rounded-lg bg-[#152028] px-3 py-2">
                          <p className="text-gray-500">Respondidos</p>
                          <p className="mt-1 text-sm text-amber-300">{campaign.respondedRecipients}</p>
                        </div>
                        <div className="rounded-lg bg-[#152028] px-3 py-2">
                          <p className="text-gray-500">Fallidos</p>
                          <p className="mt-1 text-sm text-red-300">{campaign.failedRecipients}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => openCreateModal(campaign)}
                          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600/90 px-3 py-2 text-sm text-white hover:bg-emerald-600"
                        >
                          <Copy size={16} />
                          Crear desde esta
                        </button>
                        <button
                          onClick={() => setExpandedCampaignId(isExpanded ? null : campaign.id)}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#202c33] px-3 py-2 text-sm text-gray-200 hover:bg-[#2a3942]"
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          {isExpanded ? 'Ocultar detalle' : 'Ver detalle'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-[#22313a] px-4 py-4">
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                          <div className="space-y-3">
                            <div className="rounded-lg bg-[#152028] px-3 py-3">
                              <p className="mb-1 text-xs text-gray-500">Mensaje</p>
                              <p className="whitespace-pre-wrap text-sm text-gray-100">
                                {campaign.text && campaign.text.trim().length > 0
                                  ? campaign.text
                                  : 'Sin texto; solo adjuntos.'}
                              </p>
                            </div>

                            <div className="rounded-lg bg-[#152028] px-3 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs text-gray-500">Archivo de destinatarios</p>
                                <a
                                  href={`${API_URL}${campaign.recipientsFilePath}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-emerald-300 hover:text-emerald-200"
                                >
                                  {campaign.recipientsFileName}
                                </a>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
                                <span>
                                  Numero: {campaign.number.name}
                                  {campaign.number.phoneNumber ? ` · ${campaign.number.phoneNumber}` : ''}
                                </span>
                                <span>Creada por: {campaign.createdBy.email}</span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {campaign.recipients.map((recipient) => (
                                  <span
                                    key={recipient.id}
                                    className={`rounded-full px-2 py-1 text-xs ${
                                      recipient.status === 'SENT'
                                        ? 'bg-emerald-500/20 text-emerald-300'
                                        : recipient.status === 'FAILED'
                                          ? 'bg-red-500/20 text-red-300'
                                          : 'bg-gray-500/20 text-gray-300'
                                    }`}
                                  >
                                    {recipient.phoneNumber}
                                  </span>
                                ))}
                                {campaign.totalRecipients > campaign.recipients.length && (
                                  <span className="rounded-full bg-gray-500/20 px-2 py-1 text-xs text-gray-300">
                                    +{campaign.totalRecipients - campaign.recipients.length} mas
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-lg bg-[#152028] px-3 py-3">
                            <p className="mb-2 text-xs text-gray-500">Adjuntos</p>
                            {campaign.attachments.length === 0 ? (
                              <p className="text-sm text-gray-400">Sin archivos adjuntos.</p>
                            ) : (
                              <div className="space-y-2">
                                {campaign.attachments.map((attachment) => (
                                  <a
                                    key={attachment.id}
                                    href={`${API_URL}${attachment.storagePath}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center justify-between gap-3 rounded-lg bg-[#0f171c] px-3 py-2 text-xs text-gray-200 hover:bg-[#18232b]"
                                  >
                                    <span className="truncate">{attachment.originalName}</span>
                                    <span className="shrink-0 text-gray-500">
                                      {(attachment.size / 1024 / 1024).toFixed(2)} MB
                                    </span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {isCreateModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8 backdrop-blur-sm"
          onClick={closeCreateModal}
        >
          <section
            className="w-full max-w-2xl rounded-2xl border border-[#2a3942] bg-[#111b21] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <Megaphone size={18} className="text-emerald-400" />
                <div>
                  <h1 className="text-lg font-semibold">
                    {sourceCampaign ? 'Nueva campaña desde otra existente' : 'Nueva campaña'}
                  </h1>
                  <p className="text-xs text-gray-400">
                    {sourceCampaign
                      ? 'Se cargaron los datos de la campaña anterior para que apliques los cambios que quieras.'
                      : 'El listado seguira visible detras del modal mientras preparas el envio.'}
                  </p>
                </div>
              </div>

              <button
                onClick={closeCreateModal}
                className="rounded-lg bg-[#202c33] p-2 text-gray-300 hover:bg-[#2a3942] hover:text-white"
                aria-label="Cerrar modal"
              >
                <X size={16} />
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleCreate}>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Nombre de campaña</label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ej. Promo abril clientes activos"
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                />
              </div>

              {currentUser?.role !== 'CLIENT' && (
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Numero emisor</label>
                  <select
                    value={numberId}
                    onChange={(event) => setNumberId(event.target.value)}
                    className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                  >
                    <option value="">Seleccionar numero</option>
                    {numbers.map((number) => (
                      <option key={number.id} value={number.id}>
                        {number.name}
                        {number.phoneNumber ? ` - ${number.phoneNumber}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs text-gray-400">Programar para despues (opcional)</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Si no indicas fecha y hora, la campaña comienza inmediatamente.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Archivo de destinatarios</label>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#2a3942] bg-[#202c33] px-3 py-3 text-sm text-gray-200 hover:border-emerald-500/60">
                  <Upload size={16} className="text-emerald-400" />
                  <div className="flex-1">
                    <p>
                      {recipientsFile
                        ? recipientsFile.name
                        : sourceCampaign
                          ? `Reutilizando ${sourceCampaign.recipientsFileName}`
                          : 'Subir csv, xls o xlsx'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {sourceCampaign && !recipientsFile
                        ? 'Si subes otro archivo, reemplazara el archivo de destinatarios de la campaña origen.'
                        : 'Primera hoja o archivo CSV con los numeros de los destinatarios.'}
                    </p>
                  </div>
                  <input
                    key={recipientsInputKey}
                    type="file"
                    accept=".csv,.xls,.xlsx"
                    className="hidden"
                    onChange={handleRecipientsFile}
                  />
                </label>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Texto a enviar</label>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={6}
                  placeholder="Escribe el mensaje de la campaña"
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Adjuntos</label>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#2a3942] bg-[#202c33] px-3 py-3 text-sm text-gray-200 hover:border-emerald-500/60">
                  <Paperclip size={16} className="text-emerald-400" />
                  <div className="flex-1">
                    <p>
                      {attachments.length > 0
                        ? `${attachments.length} archivo(s) seleccionados`
                        : sourceCampaign?.attachments.length
                          ? `${sourceCampaign.attachments.length} adjunto(s) reutilizados`
                        : 'Adjuntar archivos'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {sourceCampaign?.attachments.length && attachments.length === 0
                        ? 'Si subes nuevos adjuntos, reemplazaran los de la campaña origen.'
                        : 'Si son imagenes, maximo 5 y hasta 5 MB por archivo.'}
                    </p>
                  </div>
                  <input
                    key={attachmentsInputKey}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleAttachments}
                  />
                </label>

                {attachments.length > 0 && (
                  <div className="mt-2 space-y-2 rounded-lg border border-[#2a3942] bg-[#0f171c] p-3">
                    {attachments.map((file) => (
                      <div
                        key={`${file.name}-${file.size}`}
                        className="flex items-center justify-between gap-3 text-xs text-gray-300"
                      >
                        <span className="truncate">{file.name}</span>
                        <span className="shrink-0 text-gray-500">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {attachments.length === 0 && sourceCampaign?.attachments.length ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-[#2a3942] bg-[#0f171c] p-3">
                    {sourceCampaign.attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex items-center justify-between gap-3 text-xs text-gray-300"
                      >
                        <span className="truncate">{attachment.originalName}</span>
                        <span className="shrink-0 text-gray-500">
                          {(attachment.size / 1024 / 1024).toFixed(2)} MB
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-[#2a3942] bg-[#0f171c] px-3 py-2 text-xs text-gray-400">
                Intervalo de envio: un destinatario cada 10 segundos.
              </div>

              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-lg bg-[#202c33] px-4 py-2 text-sm text-gray-200 hover:bg-[#2a3942]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || loading || numbers.length === 0}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving
                    ? 'Creando campaña...'
                    : sourceCampaign
                      ? 'Crear campaña desde esta base'
                      : 'Crear campaña'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
