/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, useEffect, useContext, useCallback, useRef } from "react";
import { apiRequest, isApiError } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children}) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sessionExpired, setSessionExpired] = useState(false);
    const userRef = useRef(null);

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    const refreshUser = useCallback(async ({ silent = false } = {}) => {
        if (!silent) {
            setLoading(true);
        }

        try {
            const data = await apiRequest("/api/auth/me");
            setUser(data.user || null);
            setSessionExpired(false);
            return data.user || null;
        } catch (error) {
            if (isApiError(error) && error.status === 401 && userRef.current) {
                setSessionExpired(true);
            } else if (!silent) {
                setSessionExpired(false);
            }
            setUser(null);
            return null;
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, []);

    const markSessionExpired = useCallback(() => {
        setUser(null);
        setSessionExpired(true);
        setLoading(false);
    }, []);

    const logout = useCallback(async () => {
        try {
            await apiRequest("/api/auth/logout", { method: "POST" });
        } catch {
            // Ignore logout failures and clear local state regardless.
        } finally {
            setUser(null);
            setSessionExpired(false);
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            void refreshUser();
        }, 0);

        return () => clearTimeout(timer);
    }, [refreshUser]);


    return (
        <AuthContext.Provider value={{ user, loading, sessionExpired, refreshUser, logout, markSessionExpired }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
