import { useEffect, useState, type PropsWithChildren } from "react";
import { WhoAmI } from "../api/UserApi.ts";
import { useContext } from "react";
import { createContext } from "react";

interface ContextProps {
  user: string;
  loading: boolean;
  auth: boolean;
}

export const UserContext = createContext<ContextProps>({
  user: "",
  loading: true,
  auth: false,
});

export const ContextProvider = ({ children }: PropsWithChildren) => {
  const [user, setUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState(true);

  useEffect(() => {
    WhoAmI()
      .then((result) => {
        if (result === false) {
          setUser("");
          setAuth(false);
        } else {
          setUser(result.status);
          setAuth(true);
        }
      })
      .catch((err) => {
        console.error("Unexpected error:", err);
        setUser("");
        setAuth(false);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <UserContext.Provider value={{ user, loading, auth }}>
      {children}
    </UserContext.Provider>
  );
};

export const useGlobalContext = () => useContext(UserContext);
