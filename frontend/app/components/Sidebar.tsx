'use client';
import { useEffect, useState } from 'react';
import { MessageSquare, LogOut, Users, Building2, Megaphone, Search, MoreVertical, Settings, Loader2, X } from 'lucide-react';
import { authApi, conversationsApi, numbersApi } from '../services/api';
import QRModal from './QRModal';
import { format } from 'date-fns';

interface Number {
  id: string;
  name: string;
  phoneNumber?: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';
}

interface Conversation {
  id: string;
  waId: string;
  numberId?: string;
  name?: string;
  lastMessageAt: string;
  messages?: any[];
}

interface SidebarProps {
  currentUserRole: 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'CLIENT' | null;
  campaignsEnabled: boolean;
  numbers: Number[];
  selectedNumber: string | null;
  conversations: Conversation[];
  selectedConversation: string | null;
  conversationSearch: string;
  onConversationSearchChange: (value: string) => void;
  onConversationCleared: (id: string) => void;
  onConversationDeleted: (id: string) => void;
  onSelectNumber: (id: string) => void;
  onSelectConversation: (id: string) => void;
  onNumberStatusChange: () => void;
}

export default function Sidebar({
  currentUserRole,
  campaignsEnabled,
  numbers,
  selectedNumber,
  conversations,
  selectedConversation,
  conversationSearch,
  onConversationSearchChange,
  onConversationCleared,
  onConversationDeleted,
  onSelectNumber,
  onSelectConversation,
  onNumberStatusChange,
}: SidebarProps) {
  const [showQR, setShowQR] = useState<{ id: string; name: string } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [conversationMenuId, setConversationMenuId] = useState<string | null>(null);
  const [conversationActionId, setConversationActionId] = useState<string | null>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!showPasswordModal) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !changingPassword) {
        setShowPasswordModal(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showPasswordModal, changingPassword]);

  const handleConnect = async (num: Number) => {
    setConnecting(num.id);
    setShowQR({ id: num.id, name: num.name });
    try {
      await numbersApi.connect(num.id);
      onNumberStatusChange();
    } catch (e) {
      console.error(e);
      setShowQR(null);
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    await numbersApi.disconnect(id);
    onNumberStatusChange();
  };

  const handleLinkSession = async () => {
    setLinking(true);
    try {
      const linked = await numbersApi.linkSession();
      onNumberStatusChange();
      if (linked?.id) {
        onSelectNumber(linked.id);
      }
      if (linked?.status !== 'CONNECTED') {
        setShowQR({ id: linked.id, name: linked.name || 'WhatsApp' });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLinking(false);
    }
  };

  const statusColor = (s: string) => ({
    CONNECTED: 'bg-green-500',
    DISCONNECTED: 'bg-gray-300',
    CONNECTING: 'bg-yellow-400',
  }[s] || 'bg-gray-300');

  const normalizeConversationLabel = (value?: string) => {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';
    return rawValue.includes('@') ? rawValue.split('@')[0] : rawValue;
  };

  const getConversationDisplayName = (conversation: Conversation) =>
    normalizeConversationLabel(conversation.name)
    || normalizeConversationLabel(conversation.waId)
    || 'Sin nombre';

  const formatMessageType = (type?: string) => ({
    TEXT: 'texto',
    IMAGE: 'imagen',
    AUDIO: 'audio',
    VIDEO: 'video',
    DOCUMENT: 'documento',
    STICKER: 'sticker',
  }[String(type || '').toUpperCase()] || String(type || 'mensaje').toLowerCase());

  const handleClearConversation = async (conversation: Conversation) => {
    const confirmed = window.confirm(`¿Vaciar el chat con ${getConversationDisplayName(conversation)}?`);
    if (!confirmed) return;

    setConversationActionId(conversation.id);
    setConversationMenuId(null);
    try {
      await conversationsApi.clear(conversation.id);
      onConversationCleared(conversation.id);
    } catch (e) {
      console.error(e);
    } finally {
      setConversationActionId(null);
    }
  };

  const handleDeleteConversation = async (conversation: Conversation) => {
    const confirmed = window.confirm(`¿Eliminar el chat con ${getConversationDisplayName(conversation)}? Esta acción borra la conversación completa.`);
    if (!confirmed) return;

    setConversationActionId(conversation.id);
    setConversationMenuId(null);
    try {
      await conversationsApi.remove(conversation.id);
      onConversationDeleted(conversation.id);
    } catch (e) {
      console.error(e);
    } finally {
      setConversationActionId(null);
    }
  };

  const handleOpenPasswordModal = () => {
    setSettingsMenuOpen(false);
    setPasswordError('');
    setNewPassword('');
    setShowPasswordModal(true);
  };

  const handleClosePasswordModal = () => {
    if (changingPassword) return;
    setShowPasswordModal(false);
    setPasswordError('');
    setNewPassword('');
  };

  const handleChangePassword = async () => {
    const trimmedPassword = newPassword.trim();
    if (trimmedPassword.length < 6) {
      setPasswordError('La nueva contrasena debe tener al menos 6 caracteres.');
      return;
    }

    setChangingPassword(true);
    setPasswordError('');
    try {
      await authApi.changePassword(trimmedPassword);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    } catch (e: any) {
      setPasswordError(e.response?.data?.message || 'No se pudo cambiar la contrasena.');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <>
      <div className="flex h-full">
      <div className="w-14 bg-[#202c33] flex flex-col items-center py-4 gap-4">
        <div className="w-9 h-9 bg-green-500 rounded-full flex items-center justify-center">
          <MessageSquare size={18} className="text-white" />
        </div>
        {(currentUserRole === 'SUPER_ADMIN' || currentUserRole === 'TENANT_ADMIN') && (
          <>
            <button
              title="Administrar usuarios"
              onClick={() => { window.location.href = '/admin/users'; }}
              className="text-gray-400 hover:text-white"
            >
              <Users size={20} />
            </button>
            {currentUserRole === 'SUPER_ADMIN' && (
              <button
                title="Administrar organizaciones"
                onClick={() => { window.location.href = '/admin/tenants'; }}
                className="text-gray-400 hover:text-white"
              >
                <Building2 size={20} />
              </button>
            )}
          </>
        )}
        {campaignsEnabled && (
          <button
            title="CampaÃ±as"
            onClick={() => { window.location.href = '/campaigns'; }}
            className="text-gray-400 hover:text-white"
          >
            <Megaphone size={20} />
          </button>
        )}
        <div className="flex-1" />
        <div className="relative">
          <button
            title="Configuracion"
            onClick={() => setSettingsMenuOpen((current) => !current)}
            className="text-gray-400 hover:text-white"
          >
            <Settings size={20} />
          </button>
          {settingsMenuOpen && (
            <div className="absolute bottom-0 left-full z-20 ml-3 w-44 rounded-lg border border-[#2a3942] bg-[#111b21] py-1 shadow-xl">
              <button
                onClick={handleOpenPasswordModal}
                className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-[#202c33]"
              >
                Cambiar contrasena
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => { localStorage.clear(); window.location.href = '/login'; }}
          className="text-gray-400 hover:text-white"
        >
          <LogOut size={20} />
        </button>
      </div>

      <div className="w-52 bg-[#111b21] border-r border-[#2a3942] flex flex-col">
        <div className="p-3 border-b border-[#2a3942]">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Numeros</h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {numbers.map((num) => (
            <div
              key={num.id}
              onClick={() => onSelectNumber(num.id)}
              className={`px-3 py-3 cursor-pointer hover:bg-[#2a3942] transition ${selectedNumber === num.id ? 'bg-[#2a3942]' : ''}`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor(num.status)}`} />
                <span className="text-sm text-white truncate flex-1">{num.name}</span>
              </div>
              {num.phoneNumber && (
                <p className="text-xs text-gray-500 ml-4 truncate">{num.phoneNumber}</p>
              )}
              <div className="ml-4 mt-1">
                {num.status === 'CONNECTED' ? (
                  <div className="flex flex-col items-start gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDisconnect(num.id); }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Desconectar
                    </button>
                  </div>
                ) : num.status === 'CONNECTING' ? (
                  <span className="text-xs text-yellow-400">Conectando...</span>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleConnect(num); }}
                    disabled={connecting === num.id}
                    className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                  >
                    {connecting === num.id ? 'Iniciando...' : 'Conectar'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {numbers.length === 0 && (
            <div className="p-3 space-y-2">
              <p className="text-xs text-gray-500">Aun no hay una sesion de WhatsApp vinculada</p>
              <button
                onClick={handleLinkSession}
                disabled={linking}
                className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
              >
                {linking ? 'Iniciando vinculacion...' : 'Vincular sesion de WhatsApp'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="w-72 bg-[#111b21] border-r border-[#2a3942] flex flex-col">
        <div className="p-4 border-b border-[#2a3942]">
          <h3 className="text-sm font-semibold text-white">Conversaciones</h3>
          <div className="mt-3 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={conversationSearch}
              onChange={(e) => onConversationSearchChange(e.target.value)}
              placeholder="Buscar por nombre, numero o palabra"
              className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] py-2 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-green-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => {
            const lastMsg = conv.messages?.[0];
            const displayName = getConversationDisplayName(conv);
            const menuOpen = conversationMenuId === conv.id;
            const isProcessingAction = conversationActionId === conv.id;

            return (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`px-4 py-3 cursor-pointer hover:bg-[#2a3942] border-b border-[#1e2b33] transition ${selectedConversation === conv.id ? 'bg-[#2a3942]' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-sm font-medium">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="relative flex-1 min-w-0 pr-10">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white truncate">{displayName}</span>
                      <span className="ml-2 text-xs text-gray-500 flex-shrink-0">
                        {format(new Date(conv.lastMessageAt), 'HH:mm')}
                      </span>
                    </div>
                    <div className="absolute right-0 top-0">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConversationMenuId(menuOpen ? null : conv.id);
                          }}
                          disabled={isProcessingAction}
                          className="rounded-md p-1 text-gray-400 hover:bg-[#314048] hover:text-white disabled:opacity-50"
                          aria-label="Opciones de conversaciÃ³n"
                        >
                          <MoreVertical size={15} />
                        </button>
                        {menuOpen && (
                          <div
                            className="absolute right-0 top-8 z-10 min-w-[150px] rounded-lg border border-[#314048] bg-[#111b21] py-1 shadow-xl"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => void handleDeleteConversation(conv)}
                              className="block w-full px-3 py-2 text-left text-xs text-red-300 hover:bg-[#202c33]"
                            >
                              Eliminar chat
                            </button>
                            <button
                              onClick={() => void handleClearConversation(conv)}
                              className="block w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#202c33]"
                            >
                              Vaciar chat
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {lastMsg && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">
                        {lastMsg.type === 'TEXT' ? lastMsg.text : `[${formatMessageType(lastMsg.type)}]`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-gray-500 text-sm gap-2">
              <MessageSquare size={32} className="opacity-30" />
              <p>{conversationSearch.trim() ? 'No se encontraron conversaciones' : 'No hay conversaciones'}</p>
            </div>
          )}
        </div>
      </div>

      {showQR && (
        <QRModal
          numberId={showQR.id}
          numberName={showQR.name}
          onClose={() => setShowQR(null)}
          onConnected={onNumberStatusChange}
        />
      )}
      </div>

      {showPasswordModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={handleClosePasswordModal}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[#2a3942] bg-[#111b21] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Cambiar contrasena</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Ingresa tu nueva contrasena. Al guardar, te pediremos iniciar sesion otra vez.
                </p>
              </div>
              <button
                onClick={handleClosePasswordModal}
                className="rounded-lg bg-[#202c33] p-2 text-gray-300 hover:bg-[#2a3942] hover:text-white"
                aria-label="Cerrar modal"
              >
                <X size={16} />
              </button>
            </div>

            {passwordError && (
              <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {passwordError}
              </p>
            )}

            <div>
              <label className="mb-1 block text-xs text-gray-400">Nueva contrasena</label>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Minimo 6 caracteres"
                className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-green-500 focus:outline-none"
              />
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClosePasswordModal}
                disabled={changingPassword}
                className="rounded-lg bg-[#202c33] px-4 py-2 text-sm text-gray-200 hover:bg-[#2a3942] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleChangePassword}
                disabled={changingPassword}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {changingPassword && <Loader2 size={16} className="animate-spin" />}
                Guardar contrasena
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
