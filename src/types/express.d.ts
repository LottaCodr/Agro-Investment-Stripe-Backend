import { IUser } from "../modules/users/user.model";

declare global {
    namespace Express {
        interface Request {
            user?: IUser;
        }
    }
}
