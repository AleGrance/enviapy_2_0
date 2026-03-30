'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import { numbersApi, conversationsApi } from './services/api';
import { getSocket } from './services/socket';

export default function Home() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<'SUPER_ADMIN' | 'TENANT_ADMIN' | 'CLIENT' | null>(null);
  const [campaignsEnabled, setCampaignsEnabled] = useState(false);
  const [numbers, setNumbers] = useState<any[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState<any>(null);
  const [conversationSearch, setConversationSearch] = useState('');
  const [conversationReloadToken, setConversationReloadToken] = useState(0);
  const selectedNumberRef = useRef<string | null>(null);
  const conversationSearchRef = useRef('');

  useEffect(() => {
    selectedNumberRef.current = selectedNumber;
  }, [selectedNumber]);

  useEffect(() => {
    conversationSearchRef.current = conversationSearch;
  }, [conversationSearch]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }

    try {
      const rawUser = localStorage.getItem('user');
      if (rawUser) {
        const parsedUser = JSON.parse(rawUser);
        setUserRole(parsedUser.role || null);
        setCampaignsEnabled(Boolean(parsedUser.campaignsEnabled));
      }
    } catch (e) {
      console.error(e);
    }

    (async () => {
      try {
        await numbersApi.bootstrap();
      } catch (e) {
        console.error(e);
      }
      await loadNumbers();
    })();

    const socket = getSocket();
    socket.on('message:new', (msg: any) => {
      setNewMessage(msg);
      loadConversations(selectedNumberRef.current || undefined, conversationSearchRef.current || undefined);
    });
    socket.on('message:update', (msg: any) => {
      setNewMessage(msg);
    });
    socket.on('number:status', () => loadNumbers());
    socket.on('conversation:update', () =>
      loadConversations(selectedNumberRef.current || undefined, conversationSearchRef.current || undefined));

    return () => {
      socket.off('message:new');
      socket.off('message:update');
      socket.off('number:status');
      socket.off('conversation:update');
    };
  }, []);

  useEffect(() => {
    loadConversations(selectedNumber || undefined, conversationSearch || undefined);
  }, [selectedNumber, conversationSearch]);

  const loadNumbers = async () => {
    try {
      const data = await numbersApi.getAll();
      setNumbers(data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadConversations = async (numberId?: string, query?: string) => {
    try {
      const data = await conversationsApi.getAll(numberId, query);
      setConversations(data);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar
        currentUserRole={userRole}
        campaignsEnabled={campaignsEnabled}
        numbers={numbers}
        selectedNumber={selectedNumber}
        conversations={conversations}
        selectedConversation={selectedConversation}
        conversationSearch={conversationSearch}
        onConversationSearchChange={setConversationSearch}
        onConversationCleared={(id) => {
          if (selectedConversation === id) {
            setConversationReloadToken((value) => value + 1);
          }
          void loadConversations(selectedNumberRef.current || undefined, conversationSearchRef.current || undefined);
        }}
        onConversationDeleted={(id) => {
          if (selectedConversation === id) {
            setSelectedConversation(null);
          }
          setConversations((prev) => prev.filter((conversation) => conversation.id !== id));
          void loadConversations(selectedNumberRef.current || undefined, conversationSearchRef.current || undefined);
        }}
        onSelectNumber={(id) => {
          setSelectedNumber(id);
          setSelectedConversation(null);
        }}
        onSelectConversation={(id) => {
          setSelectedConversation(id);
          const conv = conversations.find((c) => c.id === id);
          if (conv?.numberId) {
            setSelectedNumber(conv.numberId);
          }
        }}
        onNumberStatusChange={loadNumbers}
      />
      <ChatWindow
        conversationId={selectedConversation}
        numberId={selectedNumber}
        newMessageSignal={newMessage}
        reloadToken={conversationReloadToken}
      />
    </div>
  );
}
