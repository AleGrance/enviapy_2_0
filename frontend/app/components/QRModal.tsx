'use client';
import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/socket';
import { numbersApi } from '../services/api';
import { X, Loader2 } from 'lucide-react';

interface QRModalProps {
  numberId: string;
  numberName: string;
  onClose: () => void;
  onConnected: () => void;
}

export default function QRModal({ numberId, numberName, onClose, onConnected }: QRModalProps) {
  const [qrData, setQrData] = useState<string | null>(null);
  const [status, setStatus] = useState<'waiting' | 'linked' | 'connected' | 'failed'>('waiting');
  const qrDataRef = useRef<string | null>(null);
  const statusRef = useRef<'waiting' | 'linked' | 'connected' | 'failed'>('waiting');

  useEffect(() => {
    qrDataRef.current = qrData;
  }, [qrData]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const socket = getSocket();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let isDisposed = false;

    const loadLatestQr = async () => {
      try {
        const data = await numbersApi.getQr(numberId);
        if (!isDisposed && data?.qr) {
          setQrData(data.qr);
        }
      } catch (e) {
        console.error(e);
      }
    };

    loadLatestQr();
    pollTimer = setInterval(() => {
      if (statusRef.current === 'waiting' && !qrDataRef.current) {
        void loadLatestQr();
      }
    }, 3000);

    const handleQr = (data: { numberId: string; qr: string }) => {
      if (data.numberId === numberId) {
        setQrData(data.qr);
      }
    };

    const handleLinked = (data: { numberId: string }) => {
      if (data.numberId === numberId) {
        setStatus('linked');
        setTimeout(() => {
          onConnected();
          onClose();
        }, 700);
      }
    };

    const handleNumberStatus = (data: { numberId: string; status: string }) => {
      if (data.numberId === numberId) {
        if (data.status === 'CONNECTED') {
          setStatus('connected');
          setTimeout(() => {
            onConnected();
            onClose();
          }, 700);
        } else if (data.status === 'DISCONNECTED') {
          setStatus('failed');
        }
      }
    };

    socket.on('qr', handleQr);
    socket.on('number:linked', handleLinked);
    socket.on('number:status', handleNumberStatus);

    return () => {
      isDisposed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      socket.off('qr', handleQr);
      socket.off('number:linked', handleLinked);
      socket.off('number:status', handleNumberStatus);
    };
  }, [numberId, onClose, onConnected]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-800">Conectar {numberName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {status === 'connected' ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-green-600 font-semibold">Conectado</p>
          </div>
        ) : status === 'linked' ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-green-600 font-semibold">Sesion vinculada. Finalizando configuracion...</p>
          </div>
        ) : status === 'failed' ? (
          <div className="text-center py-8">
            <p className="text-red-500">La conexion fallo. Intenta de nuevo.</p>
            <button onClick={onClose} className="mt-4 bg-gray-100 px-4 py-2 rounded-lg text-sm">Cerrar</button>
          </div>
        ) : (
          <div className="text-center">
            {qrData ? (
              <>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrData)}`}
                  alt="Codigo QR"
                  className="mx-auto rounded-xl border-4 border-gray-100"
                  width={250}
                  height={250}
                />
                <p className="text-sm text-gray-500 mt-4">Abre WhatsApp -&gt; Configuracion -&gt; Dispositivos vinculados -&gt; Vincular un dispositivo</p>
              </>
            ) : (
              <div className="flex flex-col items-center py-8 gap-3">
                <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
                <p className="text-gray-500 text-sm">Generando codigo QR...</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
