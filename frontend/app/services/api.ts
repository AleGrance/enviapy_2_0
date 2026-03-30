import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const requestUrl = err.config?.url || '';
    const isLoginRequest = requestUrl.includes('/auth/login');

    if (err.response?.status === 401 && typeof window !== 'undefined' && !isLoginRequest) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then((r) => r.data),
  changePassword: (password: string) =>
    api.patch('/auth/password', { password }).then((r) => r.data),
};

export const numbersApi = {
  getAll: () => api.get('/numbers').then((r) => r.data),
  create: (data: any) => api.post('/numbers', data).then((r) => r.data),
  connect: (id: string) => api.post(`/numbers/${id}/connect`).then((r) => r.data),
  disconnect: (id: string) => api.post(`/numbers/${id}/disconnect`).then((r) => r.data),
  reconnect: (id: string) => api.post(`/numbers/${id}/reconnect`).then((r) => r.data),
  getQr: (id: string) => api.get(`/numbers/${id}/qr`).then((r) => r.data),
  linkSession: () => api.post('/numbers/link-session').then((r) => r.data),
  bootstrap: () => api.post('/numbers/bootstrap').then((r) => r.data),
};

export const conversationsApi = {
  getAll: (numberId?: string, q?: string) =>
    api.get('/conversations', {
      params: {
        ...(numberId ? { numberId } : {}),
        ...(q ? { q } : {}),
      },
    }).then((r) => r.data),
  getOne: (id: string) => api.get(`/conversations/${id}`).then((r) => r.data),
  clear: (id: string) => api.post(`/conversations/${id}/clear`).then((r) => r.data),
  remove: (id: string) => api.delete(`/conversations/${id}`).then((r) => r.data),
};

export const messagesApi = {
  getByConversation: (conversationId: string, page = 1) =>
    api.get(`/messages/conversation/${conversationId}`, { params: { page, limit: 50 } }).then((r) => r.data),
  send: (data: any) => api.post('/messages/send', data).then((r) => r.data),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/messages/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
};

export const tenantsApi = {
  getAll: () => api.get('/tenants').then((r) => r.data),
  getOne: (id: string) => api.get(`/tenants/${id}`).then((r) => r.data),
  create: (name: string) => api.post('/tenants', { name }).then((r) => r.data),
  update: (id: string, name: string) => api.patch(`/tenants/${id}`, { name }).then((r) => r.data),
};

export const usersApi = {
  getAll: (tenantId?: string) =>
    api.get('/users', { params: tenantId ? { tenantId } : {} }).then((r) => r.data),
  create: (data: any) => api.post('/users', data).then((r) => r.data),
  update: (id: string, data: any) => api.patch(`/users/${id}`, data).then((r) => r.data),
  deactivate: (id: string) => api.patch(`/users/${id}/deactivate`).then((r) => r.data),
};

export const campaignsApi = {
  getAll: (q?: string) =>
    api.get('/campaigns', { params: q ? { q } : {} }).then((r) => r.data),
  create: (form: FormData) =>
    api.post('/campaigns', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data),
};

export default api;
