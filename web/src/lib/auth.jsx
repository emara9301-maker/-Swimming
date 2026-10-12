import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { get, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback((token, nextUser) => {
    setToken(token);
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const d = await get('/auth/me');
    setUser(d.user);
    return d.user;
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
