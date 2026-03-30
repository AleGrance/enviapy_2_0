'use client';
import { useEffect, useRef, useState } from 'react';
import { messagesApi } from '../services/api';
import { Paperclip, Send, Loader2, X, Check, CheckCheck } from 'lucide-react';
import { format } from 'date-fns';

interface Message {
  conversationId: string;
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  text?: string;
  mediaPath?: string;
  mimeType?: string;
  deliveryStatus?: 'SENT' | 'RECEIVED' | 'READ' | null;
  timestamp: string;
  from: string;
}

interface ChatWindowProps {
  conversationId: string | null;
  numberId: string | null;
  onNewMessage?: (msg: Message) => void;
  newMessageSignal?: Message | null;
  reloadToken?: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const EMOJI_JOINERS = new Set([0xfe0f, 0x200d]);

function isEmojiCodePoint(codePoint: number) {
  return (
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff)
  );
}

function isLargeEmojiInbound(msg: Message) {
  if (msg.direction !== 'INBOUND' || !msg.text) return false;
  const compact = msg.text.trim().replace(/\s+/g, '');
  if (!compact) return false;

  let emojiCount = 0;
  for (const char of Array.from(compact)) {
    const codePoint = char.codePointAt(0) || 0;
    if (EMOJI_JOINERS.has(codePoint)) continue;
    if (!isEmojiCodePoint(codePoint)) return false;
    emojiCount += 1;
  }

  return emojiCount > 0;
}

export default function ChatWindow({
  conversationId,
  numberId,
  onNewMessage,
  newMessageSignal,
  reloadToken,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; path: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    messagesApi.getByConversation(conversationId).then((data) => {
      setMessages(data.messages || []);
      setLoading(false);
    });
  }, [conversationId, reloadToken]);

  useEffect(() => {
    if (newMessageSignal && newMessageSignal.conversationId === conversationId) {
      setMessages((prev) => {
        const nextMessage = newMessageSignal as any;
        const existingIndex = prev.findIndex((message) => message.id === nextMessage.id);
        if (existingIndex === -1) {
          return [...prev, nextMessage];
        }

        const updated = [...prev];
        updated[existingIndex] = nextMessage;
        return updated;
      });
    }
  }, [newMessageSignal, conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const normalizedText = text.replace(/\r\n/g, '\n');
    const hasText = normalizedText.trim().length > 0;
    if (sending || uploading || !conversationId || (!hasText && !pendingFile)) return;
    setSending(true);
    try {
      const conv = await import('../services/api').then((m) => m.conversationsApi.getOne(conversationId));
      const resolvedNumberId = numberId || conv?.numberId;
      if (!resolvedNumberId) {
        throw new Error('Conversation has no associated numberId');
      }
      await messagesApi.send({
        numberId: resolvedNumberId,
        to: conv.waId,
        type: pendingFile ? 'document' : 'text',
        text: hasText ? normalizedText : undefined,
        mediaPath: pendingFile?.path,
      });
      setText('');
      setPendingFile(null);
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await messagesApi.upload(file);
      setPendingFile({ file, path: result.mediaPath });
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const renderMedia = (msg: Message) => {
    if (!msg.mediaPath) return null;
    const url = `${API_URL}${msg.mediaPath}`;
    const mime = msg.mimeType || '';
    const isSticker = msg.type === 'STICKER' || mime.includes('webp');
    if (mime.startsWith('image/')) {
      return (
        <img
          src={url}
          alt="media"
          className={isSticker ? 'max-w-24 rounded-lg mt-1' : 'max-w-xs rounded-lg mt-1'}
        />
      );
    }
    if (mime.startsWith('video/')) return <video src={url} controls className="max-w-xs rounded-lg mt-1" />;
    if (mime.startsWith('audio/')) return <audio src={url} controls className="mt-1" />;
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-blue-300 underline text-xs mt-1 block">
        Descargar archivo
      </a>
    );
  };

  const renderDeliveryStatus = (msg: Message) => {
    if (msg.direction !== 'OUTBOUND') {
      return null;
    }

    const deliveryStatus = msg.deliveryStatus || 'SENT';
    if (deliveryStatus === 'READ') {
      return (
        <span title="Leido" aria-label="Leido">
          <CheckCheck size={14} className="text-sky-300" />
        </span>
      );
    }
    if (deliveryStatus === 'RECEIVED') {
      return (
        <span title="Recibido" aria-label="Recibido">
          <CheckCheck size={14} className="text-green-200" />
        </span>
      );
    }
    return (
      <span title="Enviado" aria-label="Enviado">
        <Check size={14} className="text-green-200" />
      </span>
    );
  };

  if (!conversationId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0b141a] text-gray-500">
        <div className="w-20 h-20 border-2 border-gray-600 rounded-full flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" className="w-10 h-10 fill-gray-600">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
          </svg>
        </div>
        <p className="text-lg font-light">Selecciona una conversacion para comenzar a escribir</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0b141a]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex justify-center mt-10"><Loader2 className="animate-spin text-gray-400" size={24} /></div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs lg:max-w-md px-3 py-2 rounded-xl text-sm ${
                msg.direction === 'OUTBOUND'
                  ? 'bg-[#005c4b] text-white rounded-tr-none'
                  : 'bg-[#202c33] text-white rounded-tl-none'
              }`}>
                {msg.text && (
                  <p className={`whitespace-pre-wrap break-words ${isLargeEmojiInbound(msg) ? 'text-3xl leading-tight' : ''}`}>
                    {msg.text}
                  </p>
                )}
                {renderMedia(msg)}
                <div
                  className={`mt-1 flex items-center justify-end gap-1 text-xs ${
                    msg.direction === 'OUTBOUND' ? 'text-green-300' : 'text-gray-400'
                  }`}
                >
                  <span>{format(new Date(msg.timestamp), 'HH:mm')}</span>
                  {renderDeliveryStatus(msg)}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="bg-[#202c33] px-4 py-3">
        {pendingFile && (
          <div className="flex items-center gap-2 mb-2 bg-[#2a3942] px-3 py-2 rounded-lg">
            <Paperclip size={14} className="text-gray-400" />
            <span className="text-xs text-gray-300 flex-1 truncate">{pendingFile.file.name}</span>
            <button onClick={() => setPendingFile(null)}>
              <X size={14} className="text-gray-400 hover:text-white" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-gray-400 hover:text-white transition"
          >
            {uploading ? <Loader2 size={20} className="animate-spin" /> : <Paperclip size={20} />}
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Escribe un mensaje"
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-2xl bg-[#2a3942] px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={sending || (!text.trim() && !pendingFile)}
            className="w-10 h-10 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center transition disabled:opacity-50"
          >
            {sending ? <Loader2 size={18} className="animate-spin text-white" /> : <Send size={18} className="text-white" />}
          </button>
        </div>
      </div>
    </div>
  );
}
